import { realpathSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative } from "node:path";

import { eq } from "drizzle-orm";

import { type Database } from "../../platform/database/database.js";
import { dataDirectory } from "../../platform/service/runtime.js";
import { type GitState, gitState, gitWorkTreeRoot } from "../workspaces/git.js";
import { accessibleRealpath, Workspaces } from "../workspaces/workspace.js";
import { projectRoots } from "./schema.js";

/** Whether `path` is `parent` or inside it. */
export const within = (parent: string, path: string) => {
  const child = relative(parent, path);

  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
};

const realpathOrSame = (path: string) => realpath(path).catch(() => path);

/**
 * Rejects folders that would expose the admin token or a user's whole account.
 * A Git root has its own rules, since it is rarely chosen by accident.
 */
export async function assertPlainFolderAllowed(folder: string) {
  const home = await realpathOrSame(homedir());

  if (dirname(folder) === folder || within(folder, home)) {
    throw new Error(
      `${folder} is too broad to add. Choose a more specific folder.`,
    );
  }

  const data = await realpathOrSame(dataDirectory());

  if (within(folder, data) || within(data, folder)) {
    throw new Error(
      `${folder} includes this extension's own data. Choose a different folder.`,
    );
  }
}

const GIT_STATE_REUSE_MS = 10_000;

/** Only explicit user registration (UI/CLI) or configuration grants roots, never task arguments. */
export class Projects {
  private gitStates = new Map<
    string,
    { git: GitState | undefined; readAt: number }
  >();

  /** `onChange` hears each committed registration, rename and removal. */
  constructor(
    private database: Database,
    private workspaces: Workspaces,
    private onChange: () => void = () => {},
  ) {
    this.refresh();
  }

  refresh() {
    const roots = this.database.orm
      .select({ path: projectRoots.path, kind: projectRoots.kind })
      .from(projectRoots)
      .all();

    this.workspaces.allowedRoots = roots.map((r) => r.path);

    this.workspaces.exactRoots = roots
      .filter((r) => r.kind === "repository")
      .map((r) => r.path);
  }

  async register(path: string, kind: "repository" | "parent" = "repository") {
    if (!isAbsolute(path)) {
      throw new Error("Registration requires an absolute path");
    }

    const actual = await accessibleRealpath(path);

    if (!(await stat(actual)).isDirectory()) {
      throw new Error("Project root must be a directory");
    }

    if (kind === "repository") {
      const root = await gitWorkTreeRoot(actual);

      if (root === undefined) {
        await assertPlainFolderAllowed(actual);
      } else if (root !== actual) {
        throw new Error(
          `${actual} is inside the Git repository ${root}. Add ${root} instead.`,
        );
      }
    }

    this.database.orm
      .insert(projectRoots)
      .values({ path: actual, kind })
      .onConflictDoUpdate({ target: projectRoots.path, set: { kind } })
      .run();

    this.gitStates.delete(actual);
    this.refresh();
    this.onChange();

    return { repository: actual, kind };
  }

  list() {
    this.refresh();

    return this.database.orm
      .select()
      .from(projectRoots)
      .orderBy(projectRoots.path)
      .all()
      .map((r) => ({
        repository: r.path,
        name: r.name ?? basename(r.path),
        kind: r.kind,
      }));
  }

  /**
   * The list with each project's Git state. A failed probe omits `git`. The
   * panel reads this on every refresh, so a recent answer is reused. Task starts
   * always read the folder.
   */
  async listWithGit() {
    return Promise.all(
      this.list().map(
        async (project): Promise<typeof project & { git?: GitState }> => {
          if (project.kind !== "repository") return project;
          const git = await this.recentGitState(project.repository);

          return git ? { ...project, git } : project;
        },
      ),
    );
  }

  private async recentGitState(repository: string) {
    const recent = this.gitStates.get(repository);

    if (recent && Date.now() - recent.readAt < GIT_STATE_REUSE_MS) {
      return recent.git;
    }

    const git = await gitState(repository).catch(() => undefined);
    this.gitStates.set(repository, { git, readAt: Date.now() });

    return git;
  }

  rename(repository: string, name: string) {
    const trimmed = name.trim();

    if (!trimmed || trimmed.length > 200) {
      throw new Error("Project name must contain 1 to 200 characters");
    }

    const result = this.database.orm
      .update(projectRoots)
      .set({ name: trimmed })
      .where(eq(projectRoots.path, repository))
      .run();

    if (!result.changes) throw new Error("Project is no longer registered");
    this.onChange();

    return { repository, name: trimmed };
  }

  /**
   * Registry identity is used directly so missing directories can still be
   * removed. Another spelling of a saved root, such as a symlink, removes the
   * root it resolves to, so a removal never leaves the approval in place.
   * Removing a root that is already gone succeeds.
   */
  remove(repository: string) {
    this.gitStates.clear();

    const deleted = (path: string) =>
      this.database.orm
        .delete(projectRoots)
        .where(eq(projectRoots.path, path))
        .run().changes;

    if (!deleted(repository)) {
      try {
        deleted(realpathSync(repository));
      } catch {}
    }

    this.refresh();
    this.onChange();

    return { repository };
  }

  async resolve(path: string) {
    this.refresh();
    if (!isAbsolute(path)) throw new Error("Use an absolute repository path");
    const actual = await realpath(path);

    const approved = () =>
      this.list().some((root) => {
        if (root.kind === "repository") return root.repository === actual;
        const child = relative(root.repository, actual);

        return child === "" || (!child.startsWith("..") && !isAbsolute(child));
      });

    if (!approved()) {
      throw new Error(
        "Repository outside allowed roots (register this repository or approve its parent)",
      );
    }

    // Keep the existing canonical-path containment and Git-root validation too.
    const repository = await this.workspaces.repository(actual);

    // Revocation may happen while Git validation yields.
    if (!approved()) {
      throw new Error(
        "Repository outside allowed roots (register this repository or approve its parent)",
      );
    }

    return repository;
  }
}

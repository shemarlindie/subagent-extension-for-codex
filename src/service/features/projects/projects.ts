import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative } from "node:path";

import { eq } from "drizzle-orm";

import { type Database } from "../../platform/database/database.js";
import { gitRepositoryRoot } from "../workspaces/git.js";
import { Workspaces } from "../workspaces/workspace.js";
import { projectRoots } from "./schema.js";

/** Only explicit user registration (UI/CLI) or configuration grants roots, never task arguments. */
export class Projects {
  /** `onChange` hears each committed registration, rename and removal. */
  constructor(
    private database: Database,
    private workspaces: Workspaces,
    private onChange: () => void = () => {},
  ) {
    this.refresh();
  }

  refresh() {
    this.workspaces.allowedRoots = this.database.orm
      .select({ path: projectRoots.path })
      .from(projectRoots)
      .all()
      .map((r) => r.path);
  }

  async register(path: string, kind: "repository" | "parent" = "repository") {
    if (!isAbsolute(path)) {
      throw new Error("Registration requires an absolute path");
    }

    const actual = await realpath(path);

    if (!(await stat(actual)).isDirectory()) {
      throw new Error("Project root must be a directory");
    }

    if (kind === "repository" && (await gitRepositoryRoot(actual)) !== actual) {
      throw new Error("Use repository root");
    }

    this.database.orm
      .insert(projectRoots)
      .values({ path: actual, kind })
      .onConflictDoUpdate({ target: projectRoots.path, set: { kind } })
      .run();

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

  /** Registry identity is used directly so missing directories can still be removed. */
  remove(repository: string) {
    this.database.orm
      .delete(projectRoots)
      .where(eq(projectRoots.path, repository))
      .run();

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

import { access, mkdir, opendir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import { type Task } from "../../../shared/tasks/model.js";
import { logEvent } from "../../platform/logging/logger.js";
import {
  git,
  gitRepositoryRoot,
  gitState,
  gitWorkTreeRoot,
  WORKTREE_NEEDS_GIT,
} from "./git.js";
import { branchTip, workspaceDeletion } from "./workspace-deletion.js";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Whether `path` is `parent` or inside it. A name like `..notes` is inside. */
export const within = (parent: string, path: string) => {
  const child = relative(parent, path);

  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};

/**
 * A folder's real path, once the service can read it. macOS privacy controls
 * and file permissions both surface here, so the user learns what to change.
 */
export async function accessibleRealpath(path: string) {
  try {
    const actual = await realpath(path);

    if ((await stat(actual)).isDirectory()) {
      await (await opendir(actual)).close();
    }

    return actual;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "EPERM" || code === "EACCES") {
      throw new Error(
        `Can't access ${path}. On macOS, allow access in System Settings > Privacy & Security > Files & Folders, then try again.`,
        { cause: error },
      );
    }

    throw error;
  }
}

/**
 * A worktree folder and branch name: the title as a slug, then the task's
 * UUID, cut to `idLength` characters when given.
 */
function worktreeName(t: Task, idLength?: number) {
  const id = t.id.replace(/^task_/, "").slice(0, idLength);

  const slug = t.title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");

  return slug ? `${slug}-${id}` : id;
}

/** Real paths of the roots the service can still reach. Others grant nothing. */
const realRoots = (roots: string[]) =>
  Promise.all(
    roots.map(async (root) => {
      try {
        return await realpath(root);
      } catch (error) {
        // A removed or blocked project must not block other approvals or grant
        // access.
        const code = (error as NodeJS.ErrnoException).code;

        if (
          code === "ENOENT" ||
          code === "ENOTDIR" ||
          code === "EPERM" ||
          code === "EACCES"
        ) {
          return undefined;
        }

        throw error;
      }
    }),
  );

export class Workspaces {
  /** `exactRoots` lists the roots that can run without Git. */
  constructor(
    public root: string,
    public allowedRoots: string[],
    public exactRoots: string[] = [],
  ) {}

  async repository(path: string) {
    const actual = await accessibleRealpath(path);
    const roots = await realRoots(this.allowedRoots);

    if (!roots.some((root) => root !== undefined && within(root, actual))) {
      throw new Error("Repository outside allowed roots");
    }

    // Only an exact approved root may run without Git, so a parent approval
    // never reaches a plain folder inside it.
    const root = (await realRoots(this.exactRoots)).includes(actual)
      ? ((await gitWorkTreeRoot(actual)) ?? actual)
      : await gitRepositoryRoot(actual);

    if (root !== actual) throw new Error("Use repository root");

    return actual;
  }

  /**
   * Creates the task's workspace. A worktree's folder and branch take a name
   * from the title and part of the task ID, or the whole ID when that name
   * is taken in Git, on disk or by another task (`claimed`).
   */
  async create(
    t: Task,
    branchPrefix: string,
    claimed: (branch: string, workspace: string) => boolean,
  ) {
    if (t.workspace_strategy === "current_repo" && t.revision !== "HEAD") {
      throw new Error("Project folder workspace requires revision HEAD");
    }

    t.repository = await this.repository(t.repository);

    if ((await gitState(t.repository)) === "ready") {
      t.base_commit = (
        await git(t.repository, [
          "rev-parse",
          "--verify",
          "--end-of-options",
          `${t.revision}^{commit}`,
        ])
      ).trim();
    } else if (t.workspace_strategy === "worktree") {
      throw new Error(WORKTREE_NEEDS_GIT);
    }

    if (t.workspace_strategy === "current_repo") {
      t.workspace = t.repository;

      return;
    }

    const short = worktreeName(t, 6);
    const shortPath = join(this.root, short);

    const taken =
      claimed(`${branchPrefix}${short}`, shortPath) ||
      (await exists(shortPath)) ||
      !!(await branchTip(t.repository, `${branchPrefix}${short}`));

    const name = taken ? worktreeName(t) : short;

    if (taken) {
      logEvent("info", "worktree.short_name_taken", {
        task_id: t.id,
        short_name: short,
      });
    }

    const branch = (
      await git(t.repository, [
        "check-ref-format",
        "--branch",
        `${branchPrefix}${name}`,
      ]).catch(() => {
        throw new Error(`Invalid worktree branch name: ${branchPrefix}${name}`);
      })
    ).trim();

    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const workspace = join(this.root, name);

    await git(t.repository, [
      "worktree",
      "add",
      "-b",
      branch,
      workspace,
      t.base_commit!,
    ]);

    t.workspace = workspace;
    t.branch = branch;
  }

  /**
   * Removes a worktree task's worktree and keeps its branch. Uncommitted
   * changes are listed instead of removed, unless `force` discards them.
   */
  async removeWorktree(t: Task, force = false) {
    if (t.workspace_strategy !== "worktree" || !t.workspace || !t.branch) {
      throw new Error("This task has no worktree to remove.");
    }

    if (!(await exists(t.workspace))) {
      throw new Error("The worktree was already removed.");
    }

    const resources = await this.managedDeletion(t);

    if (!force) {
      // "XY path" entries; a rename or copy is followed by its old path.
      // Ignored files don't block removal.
      const entries = (
        await git(t.workspace, ["status", "--porcelain", "-z"])
      ).split("\0");

      const files: string[] = [];

      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (!entry) continue;
        files.push(entry.slice(3));
        if (/[RC]/.test(entry.slice(0, 2))) index++;
      }

      if (files.length) return { status: "uncommitted" as const, files };
    }

    await git(t.repository, [
      "worktree",
      "remove",
      ...(force ? ["--force"] : []),
      resources.worktree!,
    ]);

    return { status: "removed" as const };
  }

  /**
   * Deletes a worktree task's branch once its worktree is removed.
   */
  async deleteBranch(t: Task) {
    if (t.workspace_strategy !== "worktree" || !t.workspace || !t.branch) {
      throw new Error("This task has no branch to delete.");
    }

    if (await exists(t.workspace)) {
      throw new Error("Remove the worktree before deleting its branch.");
    }

    await this.managedDeletion(t);

    await git(t.repository, ["branch", "-D", "--end-of-options", t.branch]);
  }

  /**
   * Removes the task's worktree, including uncommitted files, and its branch.
   * A current_repo task's checkout stays as it is.
   */
  async discard(t: Task, expectedVersion?: string) {
    const resources = await this.deletion(t);

    if (expectedVersion && expectedVersion !== resources.version) {
      throw new Error(
        "Worktree or branch changed. Review the deletion details again.",
      );
    }

    if (resources.worktree) {
      await git(t.repository, [
        "worktree",
        "remove",
        "--force",
        resources.worktree,
      ]);
    }

    if (resources.branch) {
      const tip = await branchTip(t.repository, resources.branch);

      if (tip && tip !== resources.branchTip) {
        throw new Error(
          "The branch changed during cleanup. Review the deletion details again.",
        );
      }

      if (tip) {
        await git(t.repository, [
          "branch",
          "-D",
          "--end-of-options",
          resources.branch,
        ]);
      }
    }
  }

  deletion(t: Task) {
    return workspaceDeletion(t, this.root);
  }

  /** Worktree actions only change a worktree inside the managed folder. */
  private async managedDeletion(t: Task) {
    const resources = await this.deletion(t);

    if (resources.retained) {
      throw new Error(
        "The recorded worktree is outside this task's managed location.",
      );
    }

    return resources;
  }

  /** Whether a worktree task's worktree is gone, so its next turn recreates it. */
  async worktreeMissing(t: Task) {
    return (
      t.workspace_strategy === "worktree" &&
      !!t.workspace &&
      !(await exists(t.workspace))
    );
  }

  /**
   * Recreates a removed worktree at its path: from the task's branch, or,
   * when the branch was deleted too, as that branch again from the task's
   * base commit. Returns which it came from.
   */
  async recreateWorktree(t: Task): Promise<"branch" | "base"> {
    if (t.workspace_strategy !== "worktree" || !t.workspace || !t.branch) {
      throw new Error("This task has no worktree to recreate.");
    }

    // Forget a worktree whose directory was deleted without Git.
    await git(t.repository, ["worktree", "prune"]);
    await mkdir(this.root, { recursive: true, mode: 0o700 });

    if (await this.branchExists(t)) {
      await git(t.repository, ["worktree", "add", t.workspace, t.branch]);

      return "branch";
    }

    await git(t.repository, [
      "worktree",
      "add",
      "-b",
      t.branch,
      t.workspace,
      t.base_commit!,
    ]);

    return "base";
  }

  /** Whether a worktree task's branch still exists. */
  async branchExists(t: Task) {
    return git(t.repository, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${t.branch}`,
    ]).then(
      () => true,
      () => false,
    );
  }
}

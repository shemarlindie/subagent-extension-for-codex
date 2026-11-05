import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  opendir,
  realpath,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { type Task } from "../../../shared/tasks/model.js";
import {
  git,
  gitRepositoryRoot,
  gitState,
  gitWorkTreeRoot,
  WORKTREE_NEEDS_GIT,
} from "./git.js";

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

  /**
   * Records a checkout's files, as `git add -A` would stage them, as a tree
   * id. A temporary index in the extension's directory keeps the checkout's
   * own index and files untouched. `.gitignore` applies. New content is
   * written to the object store as unreferenced blobs, which `git gc` prunes
   * after its grace period.
   */
  async snapshot(cwd: string) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const dir = await mkdtemp(join(this.root, ".snapshot-"));
    const index = join(dir, "index");

    // Settings for the temporary index only. A split index would write shared
    // index files into the repository, so the copy is written whole. The
    // copy's file system monitor data belongs to the real index, so Git
    // checks file stats itself, which costs a stat per file, not a hash.
    const run = (args: string[], input?: string) =>
      git(
        cwd,
        [
          "-c",
          "core.splitIndex=false",
          "-c",
          "core.fsmonitor=false",
          // Otherwise Git would trust every cached entry, as assume-unchanged.
          "-c",
          "core.ignoreStat=false",
          ...args,
        ],
        { GIT_INDEX_FILE: index },
        input,
      );

    try {
      // Starting from a copy of the checkout's own index lets `add -A` reuse
      // its cached file stats and hash only files that changed. The tree is
      // the same as from HEAD, since `add -A` stages the working tree either
      // way (and in a sparse checkout leaves files outside the sparse set as
      // committed). The copy is never written back.
      if (await this.copyIndex(cwd, index)) {
        try {
          // `add -A` skips files marked assume-unchanged, so the copy drops
          // the mark; `ls-files -v` tags them with a lowercase letter.
          // Skip-worktree files (sparse checkouts) stay as they are.
          const assumed = (await run(["ls-files", "-v", "-z"]))
            .split("\0")
            .filter((entry) => /^[a-z] /.test(entry))
            .map((entry) => entry.slice(2));

          // Paths go on standard input, so any number of them fits.
          if (assumed.length) {
            await run(
              ["update-index", "--no-assume-unchanged", "-z", "--stdin"],
              assumed.join("\0"),
            );
          }

          await run(["add", "-A"]);

          return (await run(["write-tree"])).trim();
        } catch {
          // Not expected: `add -A` also resolves unmerged entries left by a
          // merge conflict. A failure here still gets a snapshot, from HEAD.
          await rm(index, { force: true });
        }
      }

      // Used when the checkout has no index file, or the copy failed above.
      // The tree is the same; starting from HEAD only costs a hash of every
      // tracked file.
      await run(["read-tree", "HEAD"]);
      await run(["add", "-A"]);

      return (await run(["write-tree"])).trim();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Copies a checkout's index to `target`; false when it has none. Git
   * replaces the index by renaming a finished file, so a copy is never torn.
   */
  private async copyIndex(cwd: string, target: string) {
    const path = resolve(
      cwd,
      (await git(cwd, ["rev-parse", "--git-path", "index"])).trim(),
    );

    try {
      const { atime, mtime } = await stat(path);
      await copyFile(path, target);
      // Git distrusts cached stats of files modified no earlier than the
      // index itself ("racily clean") and hashes those instead. That test
      // reads the index file's mtime, so the copy keeps the original's;
      // a new one would hide a same-size edit made just after the index
      // was written.
      await utimes(target, atime, mtime);

      return true;
    } catch {
      return false;
    }
  }

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

  /** Creates the task's workspace; worktrees get branch `<prefix><task-id>`. */
  async create(t: Task, branchPrefix = "agent/") {
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

    const branch = (
      await git(t.repository, [
        "check-ref-format",
        "--branch",
        `${branchPrefix}${t.id}`,
      ]).catch(() => {
        throw new Error(`Invalid worktree branch name: ${branchPrefix}${t.id}`);
      })
    ).trim();

    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const workspace = join(this.root, t.id);

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

    if (!force) {
      // "XY path" entries; a rename or copy is followed by its old path.
      // Ignored files don't block removal.
      const entries = (
          await git(t.workspace, ["status", "--porcelain", "-z"])
        ).split("\0"),
        files: string[] = [];

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
      t.workspace,
    ]);

    return { status: "removed" as const };
  }

  /**
   * Deletes a worktree task's branch, once its worktree is removed, and its
   * snapshot refs, since nothing reads its changes after that.
   */
  async deleteBranch(t: Task) {
    if (t.workspace_strategy !== "worktree" || !t.workspace || !t.branch) {
      throw new Error("This task has no branch to delete.");
    }

    if (await exists(t.workspace)) {
      throw new Error("Remove the worktree before deleting its branch.");
    }

    await git(t.repository, ["branch", "-D", "--end-of-options", t.branch]);
  }

  /**
   * Removes everything a task left in its repository: a worktree task's
   * worktree, uncommitted changes included, its branch and its snapshot refs.
   * A current_repo task's checkout is the user's own and stays as it is.
   */
  async discard(t: Task) {
    if (t.workspace_strategy === "worktree" && t.workspace) {
      if (await exists(t.workspace)) {
        await git(t.repository, ["worktree", "remove", "--force", t.workspace]);
      }

      if (t.branch && (await this.branchExists(t))) {
        await git(t.repository, ["branch", "-D", "--end-of-options", t.branch]);
      }
    }
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

  /** The diff between two trees or commits, as one text. */
  async diff(cwd: string, from: string, to: string) {
    return git(cwd, ["diff", "--no-ext-diff", "--no-color", from, to, "--"]);
  }
}

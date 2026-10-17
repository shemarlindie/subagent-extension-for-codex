import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { type Task } from "../../../shared/tasks/model.js";
import {
  CHANGES_PAGE_CHARS,
  type ChangeScope,
} from "../../../shared/workspaces/changes.js";
import { changedPaths, git } from "./git.js";
import { TaskChanges } from "./task-changes.js";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Where a task's snapshot refs live: `refs/agent-tasks/<task-id>/<name>`. */
const SNAPSHOT_REFS = "refs/agent-tasks";

/**
 * The snapshots a task keeps: its start, its latest turn's start and end, and
 * each replied turn's start and end, which its `agent.reply` records. A
 * current_repo task also keeps where its running stretch started (see
 * `resume`).
 */
export type SnapshotName =
  | "start"
  | "turn-start"
  | "stretch-start"
  | "end"
  | `turns/${number}/${"start" | "end"}`;

/**
 * The files a current_repo task's turns changed, for the whole task and for
 * its latest turn: blobs of NUL-separated paths, pinned beside its snapshots.
 * Task bodies are sent whole in task lists, so the paths stay out of them.
 */
type PathsName = "paths" | "turn-paths";

/** The commit a checkout's HEAD is on. */
async function headCommit(cwd: string) {
  return (await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
}

export class Workspaces {
  private taskChanges = new TaskChanges(this);

  constructor(
    public root: string,
    public allowedRoots: string[],
  ) {}

  /** A task's changes, for the whole task or its latest turn; see `TaskChanges`. */
  changes(
    t: Task,
    scope: ChangeScope = "task",
    cursor?: string,
    pageChars = CHANGES_PAGE_CHARS,
  ) {
    return this.taskChanges.changes(t, scope, cursor, pageChars);
  }

  /** A task's uncommitted changes since it, or its latest turn, started. */
  uncommittedChanges(
    t: Task,
    scope: ChangeScope = "task",
    cursor?: string,
    pageChars = CHANGES_PAGE_CHARS,
  ) {
    return this.taskChanges.uncommittedChanges(t, scope, cursor, pageChars);
  }

  /** A task's uncommitted change totals, without its file list or diff. */
  uncommittedCounts(t: Task) {
    return this.taskChanges.uncommittedCounts(t);
  }

  /** A changed file's content where the task's changes end, or as it is now. */
  changedFile(
    t: Task,
    path: string,
    cursor?: string,
    pageChars = CHANGES_PAGE_CHARS,
    uncommitted = false,
  ) {
    return this.taskChanges.changedFile(
      t,
      path,
      cursor,
      pageChars,
      uncommitted,
    );
  }

  /**
   * Records a checkout's files, as `git add -A` would stage them, as a tree
   * id. A temporary index in the extension's directory keeps the checkout's
   * own index and files untouched. `.gitignore` applies. New content is
   * written to the object store as unreferenced blobs, which `git gc` prunes
   * unless the snapshot is pinned.
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
   * Starts a turn's changes: pins the snapshot they start from (for a new
   * task's first turn, its start) and the commit HEAD is on. A current_repo
   * task's turn starts with no files recorded, and its first stretch starts
   * with it. Changes are live again until the turn ends.
   */
  async startTurn(t: Task, created: boolean) {
    t.turn_start_tree =
      created && t.start_tree
        ? t.start_tree
        : await this.snapshot(t.workspace!);

    await this.pin(t, "turn-start", t.turn_start_tree);
    // Where the turn's later commits start, for its uncommitted changes.
    t.turn_head = await headCommit(t.workspace!);

    if (t.workspace_strategy === "current_repo") {
      await this.writePaths(t, "turn-paths", []);
      t.stretch_start_tree = t.turn_start_tree;
    }

    delete t.end_tree;
  }

  /**
   * Ends a current_repo task's changes at a pinned snapshot of the checkout
   * now, when its turn ends or it waits for input, so later edits to the
   * shared checkout aren't counted. The files changed since its stretch
   * started are added to the task's and the turn's. A failed snapshot leaves
   * them as they were.
   */
  async recordEnd(t: Task) {
    if (t.workspace_strategy !== "current_repo") return;

    try {
      const end = await this.snapshot(t.workspace!);
      await this.pin(t, "end", end);
      const start = t.stretch_start_tree ?? t.turn_start_tree;

      if (start) {
        const paths = await changedPaths(t.workspace!, start, end);

        for (const name of ["paths", "turn-paths"] as const) {
          await this.addPaths(t, name, paths);
        }
      }

      t.end_tree = end;
    } catch {
      // Left as they were.
    }
  }

  /**
   * Makes a task's changes live again when it resumes after input. A
   * current_repo task starts a new stretch, so edits to the checkout while
   * it waited aren't counted; only when the wait's end was recorded, since
   * that recorded the earlier stretch's files. A failed snapshot keeps the
   * earlier start, so edits made while it waited count.
   */
  async resume(t: Task) {
    if (t.workspace_strategy === "current_repo" && t.end_tree) {
      try {
        const start = await this.snapshot(t.workspace!);
        await this.pin(t, "stretch-start", start);
        t.stretch_start_tree = start;
      } catch {
        // The earlier start stays.
      }
    }

    delete t.end_tree;
  }

  /**
   * The files a current_repo task's turns changed, for the whole task or its
   * latest turn, as recorded when each stretch ended; undefined when none
   * were recorded, as for a task from before they were.
   */
  recordedPaths(t: Task, scope: ChangeScope) {
    return this.readPaths(t, scope === "turn" ? "turn-paths" : "paths");
  }

  /** A task's recorded files, if it records them. */
  private async readPaths(t: Task, name: PathsName) {
    const id = (
      await git(t.repository, [
        "for-each-ref",
        "--format=%(objectname)",
        `${SNAPSHOT_REFS}/${t.id}/${name}`,
      ])
    ).trim();

    if (!id) return undefined;
    const blob = await git(t.repository, ["cat-file", "blob", id]);

    return new Set(blob.split("\0").filter(Boolean));
  }

  /** Replaces a task's recorded files. */
  private async writePaths(t: Task, name: PathsName, paths: Iterable<string>) {
    const blob = [...paths]
      .sort()
      .map((path) => `${path}\0`)
      .join("");

    const id = (
      await git(t.repository, ["hash-object", "-w", "--stdin"], undefined, blob)
    ).trim();

    await git(t.repository, [
      "update-ref",
      `${SNAPSHOT_REFS}/${t.id}/${name}`,
      id,
    ]);
  }

  /** Adds to a task's recorded files, when it records them. */
  private async addPaths(t: Task, name: PathsName, paths: Set<string>) {
    const recorded = await this.readPaths(t, name);

    if (recorded) {
      await this.writePaths(t, name, new Set([...recorded, ...paths]));
    }
  }

  /**
   * Keeps a task's snapshot from `git gc`, which prunes unreferenced objects
   * after two weeks, with a ref to its tree in the task's repository (whose
   * refs its worktree shares). The ref names a tree, not a commit, so it isn't
   * a branch and `git log --all` leaves it out. A later pin of the same name
   * replaces it.
   */
  async pin(t: Task, name: SnapshotName, tree: string) {
    await git(t.repository, [
      "update-ref",
      `${SNAPSHOT_REFS}/${t.id}/${name}`,
      tree,
    ]);
  }

  /** Removes a task's snapshot refs, so `git gc` can prune its snapshots. */
  async unpin(t: Task) {
    const refs = (
      await git(t.repository, [
        "for-each-ref",
        "--format=%(refname)",
        `${SNAPSHOT_REFS}/${t.id}/`,
      ])
    )
      .split("\n")
      .filter(Boolean);

    if (refs.length) {
      await git(
        t.repository,
        ["update-ref", "--stdin"],
        undefined,
        refs.map((ref) => `delete ${ref}\n`).join(""),
      );
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
    const actual = await realpath(path);

    const roots = await Promise.all(
      this.allowedRoots.map(async (root) => {
        try {
          return await realpath(root);
        } catch (error) {
          // A removed project must not block other approvals or grant access.
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT" || code === "ENOTDIR") return undefined;
          throw error;
        }
      }),
    );

    if (
      !roots.some((root) => {
        if (root === undefined) return false;
        const p = relative(root, actual);

        return !p.startsWith("..") && !isAbsolute(p);
      })
    ) {
      throw new Error("Repository outside allowed roots");
    }

    if (
      (await git(actual, ["rev-parse", "--show-toplevel"])).trim() !== actual
    ) {
      throw new Error("Use repository root");
    }

    return actual;
  }

  /** Creates the task's workspace; worktrees get branch `<prefix><task-id>`. */
  async create(t: Task, branchPrefix = "agent/") {
    if (t.workspace_strategy === "current_repo" && t.revision !== "HEAD") {
      throw new Error("Current repository workspace requires revision HEAD");
    }

    t.repository = await this.repository(t.repository);

    t.base_commit = (
      await git(t.repository, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${t.revision}^{commit}`,
      ])
    ).trim();

    if (t.workspace_strategy === "current_repo") {
      // The task's changes are measured from here, leaving out work that
      // was already uncommitted.
      t.start_tree = await this.snapshot(t.repository);
      await this.pin(t, "start", t.start_tree);
      // Its turns record the files they change from here.
      await this.writePaths(t, "paths", []);
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
      t.base_commit,
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
    await this.unpin(t);
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

    await this.unpin(t);
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

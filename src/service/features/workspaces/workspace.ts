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
  type ChangedFile,
  type ChangedFileContent,
  type Changes,
  CHANGES_PAGE_CHARS,
  type ChangeScope,
  decodeCursor,
  decodeFileCursor,
  diffPage,
  encodeCursor,
  encodeFileCursor,
  END_UNRECORDED,
  imageMime,
  isBinary,
} from "../../../shared/workspaces/changes.js";
import { git, gitBytes } from "./git.js";
import { readDiff } from "./read-diff.js";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * What a scope's changes are measured from: a worktree's base commit or a
 * current_repo task's start snapshot for the whole task, the turn snapshot
 * for the latest turn.
 */
function changesBase(t: Task, scope: ChangeScope) {
  const base =
    scope === "turn"
      ? t.turn_start_tree
      : t.workspace_strategy === "worktree"
        ? t.branch && t.base_commit
        : t.start_tree;

  // No compatibility for tasks created before branches and snapshots.
  if (!base)
    throw new Error(
      "This task predates change tracking, so its changes aren't available.",
    );

  return base;
}

/** Where a task's snapshot refs live: `refs/agent-tasks/<task-id>/<name>`. */
const SNAPSHOT_REFS = "refs/agent-tasks";

/**
 * The snapshots a task keeps: its start, its latest turn's start and end, and
 * each replied turn's start and end, which its `agent.reply` records.
 */
export type SnapshotName =
  "start" | "turn-start" | "end" | `turns/${number}/${"start" | "end"}`;

/** The tree of a checkout's HEAD commit. */
async function headTree(cwd: string) {
  return (await git(cwd, ["rev-parse", "--verify", "HEAD^{tree}"])).trim();
}

/** The commit a checkout's HEAD is on. */
export async function headCommit(cwd: string) {
  return (await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
}

/** Every path that differs between two trees; a rename lists both paths. */
async function changedPaths(cwd: string, from: string, to: string) {
  return new Set(
    (
      await git(cwd, [
        "-c",
        "core.quotePath=false",
        "diff",
        "--name-only",
        "-z",
        "--no-renames",
        from,
        to,
        "--",
      ])
    )
      .split("\0")
      .filter(Boolean),
  );
}

/** Statuses in which no turn is running or waiting for input. */
const TURN_ENDED = ["interrupted", "completed", "failed"];

/** Where a task's changes are read, or why there's nothing to read. */
type ChangesSource =
  | { state: "branch_deleted" | "end_unrecorded" }
  | {
      state?: "workspace_missing";
      cwd: string;
      /** The tree the changes end at. */
      end: () => Promise<string>;
    };

/** How many recent diffs are cached, and for how long. */
const DIFF_CACHE_SIZE = 2;
const DIFF_CACHE_MS = 60_000;

/** How many uncommitted-change baselines are cached. */
const BASELINE_CACHE_SIZE = 16;

export class Workspaces {
  constructor(
    public root: string,
    public allowedRoots: string[],
  ) {}

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
      if (await this.copyIndex(cwd, index))
        try {
          // `add -A` skips files marked assume-unchanged, so the copy drops
          // the mark; `ls-files -v` tags them with a lowercase letter.
          // Skip-worktree files (sparse checkouts) stay as they are.
          const assumed = (await run(["ls-files", "-v", "-z"]))
            .split("\0")
            .filter((entry) => /^[a-z] /.test(entry))
            .map((entry) => entry.slice(2));

          // Paths go on standard input, so any number of them fits.
          if (assumed.length)
            await run(
              ["update-index", "--no-assume-unchanged", "-z", "--stdin"],
              assumed.join("\0"),
            );
          await run(["add", "-A"]);

          return (await run(["write-tree"])).trim();
        } catch {
          // Not expected: `add -A` also resolves unmerged entries left by a
          // merge conflict. A failure here still gets a snapshot, from HEAD.
          await rm(index, { force: true });
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

    if (refs.length)
      await git(
        t.repository,
        ["update-ref", "--stdin"],
        undefined,
        refs.map((ref) => `delete ${ref}\n`).join(""),
      );
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
    )
      throw new Error("Repository outside allowed roots");
    if ((await git(actual, ["rev-parse", "--show-toplevel"])).trim() !== actual)
      throw new Error("Use repository root");

    return actual;
  }

  /** Creates the task's workspace; worktrees get branch `<prefix><task-id>`. */
  async create(t: Task, branchPrefix = "agent/") {
    if (t.workspace_strategy === "current_repo" && t.revision !== "HEAD")
      throw new Error("Current repository workspace requires revision HEAD");
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
   * Where a task's changes are read, and the tree they end at: a removed
   * worktree's branch, whose commits hold its work; a current_repo task's
   * end snapshot once its turn has ended or while it waits for input, so
   * edits to the checkout after that aren't counted; or else a snapshot of
   * its workspace taken now. Only a state when there is nothing to read: a
   * worktree's branch was deleted too, or a current_repo task ended before
   * end snapshots were recorded, so the checkout now holds later edits too.
   */
  private async changesSource(t: Task): Promise<ChangesSource> {
    if (t.workspace_strategy === "worktree" && !(await exists(t.workspace!))) {
      if (!(await this.branchExists(t))) return { state: "branch_deleted" };

      return {
        cwd: t.repository,
        state: "workspace_missing",
        end: async () =>
          (
            await git(t.repository, [
              "rev-parse",
              "--verify",
              "--end-of-options",
              `refs/heads/${t.branch}^{tree}`,
            ])
          ).trim(),
      };
    }

    if (
      t.workspace_strategy === "current_repo" &&
      !t.end_tree &&
      TURN_ENDED.includes(t.status)
    )
      return { state: "end_unrecorded" };

    return {
      cwd: t.workspace!,
      end: async () => t.end_tree ?? this.snapshot(t.workspace!),
    };
  }

  /**
   * A task's changes, read from Git: the whole task from its base (the base
   * commit of a worktree, the start snapshot of a current_repo task), or the
   * latest turn from its turn snapshot, to where its changes end.
   */
  async changes(
    t: Task,
    scope: ChangeScope = "task",
    cursor?: string,
    pageChars = CHANGES_PAGE_CHARS,
  ): Promise<Changes> {
    const empty = { scope, files: [], additions: 0, deletions: 0, diff: "" };
    if (!t.workspace) return empty;
    const base = changesBase(t, scope);
    const source = await this.changesSource(t);

    if (!("cwd" in source))
      return {
        ...empty,
        state: source.state,
        ...(t.branch ? { branch: t.branch } : {}),
      };

    const page = cursor ? decodeCursor(cursor) : undefined;
    if (page && page.base !== base) throw new Error("Stale changes cursor");
    const current = page?.current ?? (await source.end());

    const { files, parts } = await this.diffTrees(source.cwd, base, current),
      start = page?.index ?? 0,
      { diff: text, end } = diffPage(parts, start, pageChars);

    return {
      scope,
      ...(source.state ? { state: source.state } : {}),
      ...(t.branch ? { branch: t.branch } : {}),
      files,
      additions: files.reduce((sum, f) => sum + f.additions, 0),
      deletions: files.reduce((sum, f) => sum + f.deletions, 0),
      diff: text,
      ...(end < parts.length
        ? { next_cursor: encodeCursor(base, current, end) }
        : {}),
    };
  }

  /**
   * A task's uncommitted changes since it started (or since its latest turn
   * did), for the panel, in the files the task changed, as `changes` lists
   * them. A worktree is the task's own, so all of its files count for the
   * whole task. Committed work isn't shown, since it's in the Git history,
   * and a removed worktree has none.
   */
  async uncommittedChanges(
    t: Task,
    scope: ChangeScope = "task",
    cursor?: string,
    pageChars = CHANGES_PAGE_CHARS,
  ): Promise<Changes> {
    const empty = { scope, files: [], additions: 0, deletions: 0, diff: "" };
    if (!t.workspace) return empty;
    const source = await this.changesSource(t);

    if (!("cwd" in source) || source.state)
      return {
        ...empty,
        state: source.state,
        ...(t.branch ? { branch: t.branch } : {}),
      };

    const page = cursor ? decodeCursor(cursor) : undefined,
      head = await headTree(source.cwd);

    if (page && page.base !== head) throw new Error("Stale changes cursor");
    const now = page?.current ?? (await this.snapshot(source.cwd));

    const { files, parts } = await this.uncommitted(
        t,
        scope,
        source.cwd,
        now,
        head,
      ),
      start = page?.index ?? 0,
      { diff: text, end } = diffPage(parts, start, pageChars);

    return {
      scope,
      ...(t.branch ? { branch: t.branch } : {}),
      files,
      additions: files.reduce((sum, f) => sum + f.additions, 0),
      deletions: files.reduce((sum, f) => sum + f.deletions, 0),
      diff: text,
      ...(end < parts.length
        ? { next_cursor: encodeCursor(head, now, end) }
        : {}),
    };
  }

  /**
   * The files and per-file diff of a scope's uncommitted changes: from its
   * start (see `uncommittedBase`) to `now`, kept to files that differ from
   * HEAD, and in a current_repo checkout to those the task changed. A file
   * counts by its path or, renamed, its old one.
   */
  private async uncommitted(
    t: Task,
    scope: ChangeScope,
    cwd: string,
    now: string,
    head?: string,
  ) {
    head ??= await headTree(cwd);

    const start = changesBase(t, scope),
      // Tasks from before turn_head use the commit the task started on.
      headThen = (scope === "turn" && t.turn_head) || t.base_commit!;

    const [diff, pending, relevant] = await Promise.all([
      this.uncommittedBase(cwd, start, headThen, head).then((from) =>
        this.diffTrees(cwd, from, now),
      ),
      // Files that differ from HEAD now: what a commit would take.
      changedPaths(cwd, head, now),
      // A worktree is the task's own. A current_repo task's changes end at
      // its end snapshot, so files only others edited after that don't count.
      t.workspace_strategy === "worktree" && scope === "task"
        ? undefined
        : changedPaths(cwd, start, t.end_tree ?? now),
    ]);

    // A rename counts by either path.
    const keep = diff.files.map((f) => {
      const paths = f.old_path === undefined ? [f.path] : [f.path, f.old_path];

      return (
        paths.some((path) => pending.has(path)) &&
        (!relevant || paths.some((path) => relevant.has(path)))
      );
    });

    return {
      files: diff.files.filter((_, index) => keep[index]),
      parts: diff.parts.filter((_, index) => keep[index]),
    };
  }

  /**
   * What uncommitted changes since `start` are measured from: the `start`
   * snapshot, except files committed since (those that differ between
   * `headThen`, the commit HEAD was on at `start`, and the tree HEAD has
   * now), taken as HEAD has them now. Edits already uncommitted at `start`
   * are left out, and so is anything committed after it. Its inputs never
   * change, so recent ones are cached: every page and preview reads the same.
   */
  private uncommittedBase(
    cwd: string,
    start: string,
    headThen: string,
    headNow: string,
  ) {
    const key = `${cwd}\0${start}\0${headThen}\0${headNow}`,
      cached = this.baselines.get(key);

    if (cached) return cached;

    const base = this.buildUncommittedBase(cwd, start, headThen, headNow);
    this.baselines.set(key, base);

    // A failed build isn't kept, so the next read tries again.
    base.catch(() => {
      if (this.baselines.get(key) === base) this.baselines.delete(key);
    });

    // Maps keep insertion order, so the first entries are the oldest.
    for (const entry of this.baselines.keys())
      if (this.baselines.size > BASELINE_CACHE_SIZE)
        this.baselines.delete(entry);

    return base;
  }

  /** Recent baselines by their inputs; each is only a tree id. */
  private baselines = new Map<string, Promise<string>>();

  private async buildUncommittedBase(
    cwd: string,
    start: string,
    headThen: string,
    headNow: string,
  ) {
    const tree = async (rev: string) =>
      (await git(cwd, ["rev-parse", "--verify", `${rev}^{tree}`])).trim();

    const [startTree, thenTree] = await Promise.all([
      tree(start),
      tree(headThen),
    ]);

    // Nothing committed since, or nothing uncommitted at the start.
    if (thenTree === headNow) return startTree;
    if (startTree === thenTree) return headNow;

    // "<mode> <mode> <id> <id> <status>", then the path; a deleted file's new
    // mode is 000000, which removes it from the index.
    const raw = (
      await git(cwd, [
        "diff",
        "--raw",
        "-z",
        "--no-renames",
        "--no-abbrev",
        thenTree,
        headNow,
        "--",
      ])
    ).split("\0");

    const entries: string[] = [];

    for (let index = 0; index + 1 < raw.length; index += 2) {
      const [, mode, , id] = raw[index].slice(1).split(" ");
      entries.push(`${mode} ${id}\t${raw[index + 1]}`);
    }

    // In a temporary index, the start snapshot with the committed files laid
    // over it, written as a tree. The checkout's own index isn't touched.
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const dir = await mkdtemp(join(this.root, ".baseline-"));
    const env = { GIT_INDEX_FILE: join(dir, "index") };

    try {
      await git(cwd, ["read-tree", startTree], env);

      await git(
        cwd,
        ["update-index", "-z", "--index-info"],
        env,
        entries.map((entry) => `${entry}\0`).join(""),
      );

      return (await git(cwd, ["write-tree"], env)).trim();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Recent diffs by checkout and tree pair. Reading a large diff page by page
   * asks for the same pair once per page; trees never change, so a cached
   * diff is always exact, and a refresh with no new edits also snapshots to
   * the same tree. Only a few are kept, briefly, since each holds a whole
   * diff in memory. Entries are promises, so concurrent reads share one run.
   */
  private diffs = new Map<
    string,
    {
      expires: number;
      diff: Promise<{ files: ChangedFile[]; parts: string[] }>;
    }
  >();

  /** The file list and the per-file diff between two trees, cached. */
  private diffTrees(cwd: string, base: string, current: string) {
    const key = `${cwd}\0${base}\0${current}`,
      now = Date.now();

    for (const [entry, { expires }] of this.diffs)
      if (expires <= now) this.diffs.delete(entry);

    const cached = this.diffs.get(key);
    if (cached) return cached.diff;

    const diff = readDiff(cwd, base, current);
    this.diffs.set(key, { expires: now + DIFF_CACHE_MS, diff });

    // A failed read isn't kept, so the next request tries again; a newer
    // entry for the same pair, stored after this one expired, stays.
    diff.catch(() => {
      if (this.diffs.get(key)?.diff === diff) this.diffs.delete(key);
    });

    // Maps keep insertion order, so the first entries are the oldest.
    for (const entry of this.diffs.keys())
      if (this.diffs.size > DIFF_CACHE_SIZE) this.diffs.delete(entry);

    return diff;
  }

  /**
   * The content of a file the task changed, where its changes end (see
   * `changesSource`), or for `uncommitted`, a file among its uncommitted
   * changes as it is now. Only paths in the task's or the latest turn's
   * changes are read. Images come as base64, other binary files as their
   * size only, and large contents in parts through `next_cursor`.
   */
  async changedFile(
    t: Task,
    path: string,
    cursor?: string,
    pageChars = CHANGES_PAGE_CHARS,
    uncommitted = false,
  ): Promise<ChangedFileContent> {
    if (!t.workspace) throw new Error("This task hasn't changed any files.");
    const source = await this.changesSource(t);

    if (!("cwd" in source))
      throw new Error(
        source.state === "end_unrecorded"
          ? END_UNRECORDED
          : `The worktree and its branch ${t.branch} were deleted, so this file is unavailable.`,
      );
    if (uncommitted && source.state)
      throw new Error(
        `The worktree was removed, so nothing is uncommitted; its commits are on branch ${t.branch}.`,
      );

    // Later parts read the tree the first part read.
    const { tree, offset } = cursor
      ? decodeFileCursor(cursor)
      : {
          tree: await (uncommitted ? this.snapshot(source.cwd) : source.end()),
          offset: 0,
        };

    // Every part checks the path, so a cursor can't reach other files. A file
    // changed in the latest turn may match the task's base again.
    const scopes: ChangeScope[] = t.turn_start_tree
      ? ["task", "turn"]
      : ["task"];

    const changed = await Promise.all(
      scopes.map(async (scope) =>
        uncommitted
          ? (await this.uncommitted(t, scope, source.cwd, tree)).files.map(
              (f) => f.path,
            )
          : (
              await git(source.cwd, [
                "-c",
                "core.quotePath=false",
                "diff",
                "--no-ext-diff",
                "-M",
                "--name-only",
                "-z",
                changesBase(t, scope),
                tree,
                "--",
              ])
            ).split("\0"),
      ),
    );

    if (!changed.flat().includes(path))
      throw new Error(
        `${path} is not among this task's ${uncommitted ? "uncommitted " : ""}changes.`,
      );

    const object = `${tree}:${path}`;

    if (
      !(await git(source.cwd, ["cat-file", "-e", object]).then(
        () => true,
        () => false,
      ))
    )
      return { path, state: "deleted", size: 0 };

    const bytes = await gitBytes(source.cwd, ["cat-file", "blob", object]),
      image = imageMime(path);

    if (!image && isBinary(bytes))
      return { path, state: "binary", size: bytes.length };

    const content = Buffer.from(bytes).toString(image ? "base64" : "utf8"),
      end = offset + pageChars;

    return {
      path,
      state: "present",
      size: bytes.length,
      ...(image ? { mime_type: image } : {}),
      encoding: image ? "base64" : "utf8",
      content: content.slice(offset, end),
      ...(end < content.length
        ? { next_cursor: encodeFileCursor(tree, end) }
        : {}),
    };
  }

  /**
   * Removes a worktree task's worktree and keeps its branch. Uncommitted
   * changes are listed instead of removed, unless `force` discards them.
   */
  async removeWorktree(t: Task, force = false) {
    if (t.workspace_strategy !== "worktree" || !t.workspace || !t.branch)
      throw new Error("This task has no worktree to remove.");
    if (!(await exists(t.workspace)))
      throw new Error("The worktree was already removed.");

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
    if (t.workspace_strategy !== "worktree" || !t.workspace || !t.branch)
      throw new Error("This task has no branch to delete.");
    if (await exists(t.workspace))
      throw new Error("Remove the worktree before deleting its branch.");
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
      if (await exists(t.workspace))
        await git(t.repository, ["worktree", "remove", "--force", t.workspace]);

      if (t.branch && (await this.branchExists(t)))
        await git(t.repository, ["branch", "-D", "--end-of-options", t.branch]);
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
    if (t.workspace_strategy !== "worktree" || !t.workspace || !t.branch)
      throw new Error("This task has no worktree to recreate.");
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

import { access } from "node:fs/promises";

import { type Task } from "../../../shared/tasks/model.js";
import {
  type ChangeCounts,
  changeCounts,
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
import { changedPaths, git, gitBytes } from "./git.js";
import { readDiff } from "./read-diff.js";
import { buildUncommittedBase } from "./uncommitted-base.js";

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** A worktree task's base commit, or a current_repo task's start snapshot. */
function taskBase(t: Task) {
  if (t.workspace_strategy === "worktree") return t.branch && t.base_commit;

  return t.start_tree;
}

/**
 * What a scope's changes are measured from: a worktree's base commit or a
 * current_repo task's start snapshot for the whole task, the turn snapshot
 * for the latest turn.
 */
function changesBase(t: Task, scope: ChangeScope) {
  const base = scope === "turn" ? t.turn_start_tree : taskBase(t);

  // Without its starting snapshot, there is nothing to compare against.
  if (!base) {
    throw new Error(
      "This task has no change snapshot, so its changes aren't available.",
    );
  }

  return base;
}

/** The tree of a checkout's HEAD commit. */
async function headTree(cwd: string) {
  return (await git(cwd, ["rev-parse", "--verify", "HEAD^{tree}"])).trim();
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

/** What reading changes needs from the task's workspaces. */
interface WorkspaceAccess {
  /** Where temporary indexes are written. */
  root: string;
  snapshot(cwd: string): Promise<string>;
  branchExists(t: Task): Promise<boolean>;
  recordedPaths(t: Task, scope: ChangeScope): Promise<Set<string> | undefined>;
}

/** Whether a changed file has a path in `paths`; a rename counts by either. */
function touches(f: ChangedFile, paths: Set<string>) {
  return (
    paths.has(f.path) || (f.old_path !== undefined && paths.has(f.old_path))
  );
}

/** A diff's files and their parts, kept to those `keep` accepts. */
function keepFiles(
  diff: { files: ChangedFile[]; parts: string[] },
  keep: (f: ChangedFile) => boolean,
) {
  const kept = diff.files.map(keep);

  return {
    files: diff.files.filter((_, index) => kept[index]),
    parts: diff.parts.filter((_, index) => kept[index]),
  };
}

/**
 * Reads a task's changes from Git: the whole task or its latest turn, all of
 * them or only the uncommitted ones, and a changed file's content. Recent
 * diffs and uncommitted baselines are cached, since paged reads ask for the
 * same trees again.
 */
export class TaskChanges {
  constructor(private workspaces: WorkspaceAccess) {}

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
      const branch = await this.workspaces.branchExists(t);
      if (!branch) return { state: "branch_deleted" };

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
    ) {
      return { state: "end_unrecorded" };
    }

    return {
      cwd: t.workspace!,
      end: async () => t.end_tree ?? this.workspaces.snapshot(t.workspace!),
    };
  }

  /**
   * The files a current_repo task changed while its turns ran, for the whole
   * task or its latest turn: those recorded as each stretch ended, and while
   * one runs, those it has changed so far (to `now`). Undefined for a
   * worktree, whose files are all its own, and for a task from before files
   * were recorded.
   */
  private async turnPaths(
    t: Task,
    scope: ChangeScope,
    cwd: string,
    now: string,
  ) {
    if (t.workspace_strategy !== "current_repo") return undefined;
    const paths = await this.workspaces.recordedPaths(t, scope);

    if (paths && !t.end_tree && t.stretch_start_tree) {
      for (const path of await changedPaths(cwd, t.stretch_start_tree, now)) {
        paths.add(path);
      }
    }

    return paths;
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

    if (!("cwd" in source)) {
      return {
        ...empty,
        state: source.state,
        ...(t.branch ? { branch: t.branch } : {}),
      };
    }

    const page = cursor ? decodeCursor(cursor) : undefined;
    if (page && page.base !== base) throw new Error("Stale changes cursor");
    const current = page?.current ?? (await source.end());

    const [diff, paths] = await Promise.all([
      this.diffTrees(source.cwd, base, current),
      this.turnPaths(t, scope, source.cwd, current),
    ]);

    const { files, parts } = paths
        ? keepFiles(diff, (f) => touches(f, paths))
        : diff,
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

    if (!("cwd" in source) || source.state) {
      return {
        ...empty,
        state: source.state,
        ...(t.branch ? { branch: t.branch } : {}),
      };
    }

    const page = cursor ? decodeCursor(cursor) : undefined,
      head = await headTree(source.cwd);

    if (page && page.base !== head) throw new Error("Stale changes cursor");
    const now = page?.current ?? (await this.workspaces.snapshot(source.cwd));

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
   * A task's uncommitted change totals, as the Changes tab reads them, without
   * its file list or diff text. Git and the cached diff still run once.
   */
  async uncommittedCounts(t: Task): Promise<ChangeCounts> {
    return changeCounts(await this.uncommittedChanges(t));
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
      this.relevantPaths(t, scope, cwd, start, now),
    ]);

    return keepFiles(
      diff,
      (f) => touches(f, pending) && (!relevant || touches(f, relevant)),
    );
  }

  /**
   * The files a scope's uncommitted changes can include: all of a worktree's
   * for the whole task, since it's the task's own; the files a current_repo
   * task changed while its turns ran (see `turnPaths`); or, for a task from
   * before those were recorded, those that changed between the scope's
   * start and where its changes end, so files only others edited after
   * that don't count.
   */
  private async relevantPaths(
    t: Task,
    scope: ChangeScope,
    cwd: string,
    start: string,
    now: string,
  ) {
    if (t.workspace_strategy === "worktree" && scope === "task") {
      return undefined;
    }

    return (
      (await this.turnPaths(t, scope, cwd, now)) ??
      changedPaths(cwd, start, t.end_tree ?? now)
    );
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

    const base = buildUncommittedBase(
      this.workspaces.root,
      cwd,
      start,
      headThen,
      headNow,
    );

    this.baselines.set(key, base);

    // A failed build isn't kept, so the next read tries again.
    base.catch(() => {
      if (this.baselines.get(key) === base) this.baselines.delete(key);
    });

    // Maps keep insertion order, so the first entries are the oldest.
    for (const entry of this.baselines.keys()) {
      if (this.baselines.size > BASELINE_CACHE_SIZE) {
        this.baselines.delete(entry);
      }
    }

    return base;
  }

  /** Recent baselines by their inputs; each is only a tree id. */
  private baselines = new Map<string, Promise<string>>();

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

    for (const [entry, { expires }] of this.diffs) {
      if (expires <= now) this.diffs.delete(entry);
    }

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
    for (const entry of this.diffs.keys()) {
      if (this.diffs.size > DIFF_CACHE_SIZE) this.diffs.delete(entry);
    }

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

    if (!("cwd" in source)) {
      throw new Error(
        source.state === "end_unrecorded"
          ? END_UNRECORDED
          : `The worktree and its branch ${t.branch} were deleted, so this file is unavailable.`,
      );
    }

    if (uncommitted && source.state) {
      throw new Error(
        `The worktree was removed, so nothing is uncommitted; its commits are on branch ${t.branch}.`,
      );
    }

    // Later parts read the tree the first part read.
    const { tree, offset } = cursor
      ? decodeFileCursor(cursor)
      : {
          tree: await (uncommitted
            ? this.workspaces.snapshot(source.cwd)
            : source.end()),
          offset: 0,
        };

    // Every part checks the path, so a cursor can't reach other files. A file
    // changed in the latest turn may match the task's base again.
    const scopes: ChangeScope[] = t.turn_start_tree
      ? ["task", "turn"]
      : ["task"];

    const changed = await Promise.all(
      scopes.map(async (scope) => {
        if (uncommitted) {
          return (await this.uncommitted(t, scope, source.cwd, tree)).files.map(
            (f) => f.path,
          );
        }

        const [names, paths] = await Promise.all([
          git(source.cwd, [
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
          ]),
          this.turnPaths(t, scope, source.cwd, tree),
        ]);

        return names.split("\0").filter((name) => !paths || paths.has(name));
      }),
    );

    if (!changed.flat().includes(path)) {
      throw new Error(
        `${path} is not among this task's ${uncommitted ? "uncommitted " : ""}changes.`,
      );
    }

    const object = `${tree}:${path}`;

    if (
      !(await git(source.cwd, ["cat-file", "-e", object]).then(
        () => true,
        () => false,
      ))
    ) {
      return { path, state: "deleted", size: 0 };
    }

    const bytes = await gitBytes(source.cwd, ["cat-file", "blob", object]),
      image = imageMime(path);

    if (!image && isBinary(bytes)) {
      return { path, state: "binary", size: bytes.length };
    }

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
}

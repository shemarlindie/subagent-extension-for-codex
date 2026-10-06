import { execFile } from "node:child_process";
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
import { promisify } from "node:util";

import { type Task } from "../../shared/contracts.js";
import {
  type ChangedFile,
  type ChangedFileContent,
  changedFiles,
  type Changes,
  CHANGES_PAGE_CHARS,
  type ChangeScope,
  decodeCursor,
  decodeFileCursor,
  diffPage,
  diffParts,
  encodeCursor,
  encodeFileCursor,
  imageMime,
  isBinary,
} from "./changes.js";

const exec = promisify(execFile);

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** Runs Git in `cwd`, optionally writing `input` to its standard input. */
export async function git(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  input?: string,
) {
  const run = exec("git", ["-C", cwd, ...args], {
    // Diffs are returned whole, however large.
    maxBuffer: 1024 * 1024 * 1024,
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });

  // Closed even without input, so no command waits on it.
  run.child.stdin?.end(input ?? "");

  return (await run).stdout;
}

/** Git output as bytes, for file contents that may be binary. */
async function gitBytes(cwd: string, args: string[]) {
  return (
    await exec("git", ["-C", cwd, ...args], {
      encoding: "buffer",
      maxBuffer: 1024 * 1024 * 1024,
    })
  ).stdout;
}

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

/** The snapshots a task keeps: its start, and its latest turn's start and end. */
export type SnapshotName = "start" | "turn-start" | "end";

/** How many recent diffs are cached, and for how long. */
const DIFF_CACHE_SIZE = 2;
const DIFF_CACHE_MS = 60_000;

/**
 * Runs Git for the changes between two trees: every changed file with its
 * stats, and the unified diff split into one part per file, in the same order.
 */
async function readDiff(cwd: string, base: string, current: string) {
  const diff = (...args: string[]) =>
    git(cwd, [
      "-c",
      "core.quotePath=false",
      "diff",
      "--no-ext-diff",
      "--no-color",
      "-M",
      ...args,
      base,
      current,
      "--",
    ]);

  const [nameStatus, numstat, patch] = await Promise.all([
    diff("-z", "--name-status"),
    diff("-z", "--numstat"),
    diff("--src-prefix=a/", "--dst-prefix=b/"),
  ]);

  const files = changedFiles(nameStatus, numstat);

  // Binary files have no line counts, so the list shows their size instead,
  // read for all of them at once: "<mode> blob <id> <size>\t<path>".
  const binary = files.filter(
    (file) => file.binary && file.status !== "deleted",
  );

  if (binary.length) {
    const sizes = new Map(
      (
        await git(cwd, [
          "ls-tree",
          "-r",
          "-l",
          "-z",
          current,
          "--",
          ...binary.map((file) => file.path),
        ])
      )
        .split("\0")
        .filter(Boolean)
        .map((entry) => {
          const [meta, path] = entry.split("\t");

          return [path, Number(meta.trim().split(/\s+/)[3])] as const;
        }),
    );

    for (const file of binary) file.size = sizes.get(file.path);
  }

  return { files, parts: diffParts(patch) };
}

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
   * end snapshot once its turn has ended, so later edits to the checkout
   * aren't counted; or else a snapshot of its workspace taken now. None once
   * a worktree's branch is deleted too.
   */
  private async changesSource(t: Task) {
    if (t.workspace_strategy === "worktree" && !(await exists(t.workspace!))) {
      if (!(await this.branchExists(t))) return undefined;

      return {
        cwd: t.repository,
        removed: true,
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

    return {
      cwd: t.workspace!,
      removed: false,
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

    if (!source) return { ...empty, state: "branch_deleted", branch: t.branch };

    const page = cursor ? decodeCursor(cursor) : undefined;
    if (page && page.base !== base) throw new Error("Stale changes cursor");
    const current = page?.current ?? (await source.end());

    const { files, parts } = await this.diffTrees(source.cwd, base, current),
      start = page?.index ?? 0,
      { diff: text, end } = diffPage(parts, start, pageChars);

    return {
      scope,
      ...(source.removed ? { state: "workspace_missing" as const } : {}),
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
   * `changesSource`). Only paths in the task's or the latest turn's changes
   * are read. Images come as base64, other binary files as their size only,
   * and large contents in parts through `next_cursor`.
   */
  async changedFile(
    t: Task,
    path: string,
    cursor?: string,
    pageChars = CHANGES_PAGE_CHARS,
  ): Promise<ChangedFileContent> {
    if (!t.workspace) throw new Error("This task hasn't changed any files.");
    const source = await this.changesSource(t);

    if (!source)
      throw new Error(
        `The worktree and its branch ${t.branch} were deleted, so this file is unavailable.`,
      );

    // Later parts read the tree the first part read.
    const { tree, offset } = cursor
      ? decodeFileCursor(cursor)
      : { tree: await source.end(), offset: 0 };

    // Every part checks the path, so a cursor can't reach other files. A file
    // changed in the latest turn may match the task's base again.
    const scopes: ChangeScope[] = t.turn_start_tree
      ? ["task", "turn"]
      : ["task"];

    const changed = await Promise.all(
      scopes.map(async (scope) =>
        (
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
      throw new Error(`${path} is not among this task's changes.`);

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

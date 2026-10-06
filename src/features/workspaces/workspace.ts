import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";

import { type Task } from "../../shared/contracts.js";
import {
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

export async function git(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) {
  return (
    await exec("git", ["-C", cwd, ...args], {
      // Diffs are returned whole, however large.
      maxBuffer: 1024 * 1024 * 1024,
      ...(env ? { env: { ...process.env, ...env } } : {}),
    })
  ).stdout;
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

export class Workspaces {
  constructor(
    public root: string,
    public allowedRoots: string[],
  ) {}

  /**
   * Records a checkout's files, as `git add -A` would stage them, as a tree
   * id. A temporary index in the extension's directory keeps the checkout's
   * own index and files untouched. `.gitignore` applies. New content is
   * written to the object store as unreferenced blobs, which `git gc` prunes.
   */
  async snapshot(cwd: string) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const dir = await mkdtemp(join(this.root, ".snapshot-"));
    const env = { GIT_INDEX_FILE: join(dir, "index") };

    try {
      await git(cwd, ["read-tree", "HEAD"], env);
      await git(cwd, ["add", "-A"], env);

      return (await git(cwd, ["write-tree"], env)).trim();
    } finally {
      await rm(dir, { recursive: true, force: true });
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
   * A task's changes, live from Git: the whole task from its base (the base
   * commit of a worktree, the start snapshot of a current_repo task), or the
   * latest turn from its turn snapshot, to a snapshot taken now.
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

    if (t.workspace_strategy === "worktree" && !(await exists(t.workspace)))
      return { ...empty, state: "workspace_missing", branch: t.branch };

    const page = cursor ? decodeCursor(cursor) : undefined;
    if (page && page.base !== base) throw new Error("Stale changes cursor");
    const current = page?.current ?? (await this.snapshot(t.workspace));

    const diff = (...args: string[]) =>
      git(t.workspace!, [
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
          await git(t.workspace, [
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

    const parts = diffParts(patch),
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
        ? { next_cursor: encodeCursor(base, current, end) }
        : {}),
    };
  }

  /**
   * The current content of a file the task changed, read from a snapshot of
   * its workspace. Only paths in the task's or the latest turn's changes are
   * read. Images come as base64, other binary files as their size only, and
   * large contents in parts through `next_cursor`.
   */
  async changedFile(
    t: Task,
    path: string,
    cursor?: string,
    pageChars = CHANGES_PAGE_CHARS,
  ): Promise<ChangedFileContent> {
    if (!t.workspace) throw new Error("This task hasn't changed any files.");
    if (t.workspace_strategy === "worktree" && !(await exists(t.workspace)))
      throw new Error(
        `The worktree was removed; this file is on branch ${t.branch}.`,
      );

    // Later parts read the snapshot the first part took.
    const { tree, offset } = cursor
      ? decodeFileCursor(cursor)
      : { tree: await this.snapshot(t.workspace), offset: 0 };

    // Every part checks the path, so a cursor can't reach other files. A file
    // changed in the latest turn may match the task's base again.
    const scopes: ChangeScope[] = t.turn_start_tree
      ? ["task", "turn"]
      : ["task"];

    const changed = await Promise.all(
      scopes.map(async (scope) =>
        (
          await git(t.workspace!, [
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
      !(await git(t.workspace, ["cat-file", "-e", object]).then(
        () => true,
        () => false,
      ))
    )
      return { path, state: "deleted", size: 0 };

    const bytes = await gitBytes(t.workspace, ["cat-file", "blob", object]),
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

  /** The diff between two trees or commits, as one text. */
  async diff(cwd: string, from: string, to: string) {
    return git(cwd, ["diff", "--no-ext-diff", "--no-color", from, to, "--"]);
  }
}

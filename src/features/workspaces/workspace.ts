import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";

import { type Task } from "../../shared/contracts.js";
import {
  changedFiles,
  type Changes,
  CHANGES_PAGE_CHARS,
  type ChangeScope,
  decodeCursor,
  diffPage,
  diffParts,
  encodeCursor,
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

    const files = changedFiles(nameStatus, numstat),
      parts = diffParts(patch),
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

  /** The diff between two trees or commits, as one text. */
  async diff(cwd: string, from: string, to: string) {
    return git(cwd, ["diff", "--no-ext-diff", "--no-color", from, to, "--"]);
  }
}

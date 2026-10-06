import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { promisify } from "node:util";

import { type Task } from "../../shared/contracts.js";

const exec = promisify(execFile);

export async function git(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) {
  return (
    await exec("git", ["-C", cwd, ...args], {
      maxBuffer: 16 * 1024 * 1024,
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

  async diff(t: Task) {
    if (!t.workspace || !t.base_commit) return "";
    let diff = await git(t.workspace, ["diff", t.base_commit, "--"]);

    const untracked = (
      await git(t.workspace, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ])
    )
      .split("\0")
      .filter(Boolean);

    for (const f of untracked) {
      try {
        diff += await git(t.workspace, [
          "diff",
          "--no-index",
          "--",
          "/dev/null",
          f,
        ]);
      } catch (error) {
        const e = error as { code?: number; stdout?: string };
        if (e.code === 1 && e.stdout) diff += e.stdout;
        else throw error;
      }
    }

    return diff;
  }
}

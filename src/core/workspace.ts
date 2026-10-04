import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, realpath } from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import { type Task } from "./model.js";

const exec = promisify(execFile);

export async function git(cwd: string, args: string[]) {
  return (
    await exec("git", ["-C", cwd, ...args], { maxBuffer: 16 * 1024 * 1024 })
  ).stdout;
}

export class Workspaces {
  constructor(
    public root: string,
    public allowedRoots: string[],
  ) {}

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

  async create(t: Task) {
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
      t.workspace = t.repository;

      return;
    }

    await mkdir(this.root, { recursive: true, mode: 0o700 });
    t.workspace = join(this.root, t.id);

    await git(t.repository, [
      "worktree",
      "add",
      "--detach",
      t.workspace,
      t.base_commit,
    ]);
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

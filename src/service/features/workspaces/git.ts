import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import type { GitState } from "../../../shared/tasks/model.js";

const exec = promisify(execFile);

/** Runs Git in `cwd`, optionally writing `input` to its standard input. */
export async function git(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  input?: string,
  timeoutMs?: number,
) {
  const run = exec("git", ["-C", cwd, ...args], {
    // Diffs are returned whole, however large.
    maxBuffer: 1024 * 1024 * 1024,
    ...(timeoutMs
      ? { timeout: timeoutMs, killSignal: "SIGKILL" as const }
      : {}),
    ...(env ? { env: { ...process.env, ...env } } : {}),
  });

  // Git may exit before reading its input, so writing to it fails with EPIPE.
  // Its exit status and stderr report the command's outcome instead.
  let stdinError: Error | undefined;

  run.child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") stdinError = error;
  });

  // Closed even without input, so no command waits on it.
  run.child.stdin?.end(input ?? "");

  const { stdout } = await run;
  if (stdinError) throw stdinError;

  return stdout;
}

const ROOT_PROBE_TIMEOUT_MS = 5000;

/**
 * Bound the read-only Git probe without limiting worktree writes or snapshots.
 * Returns the root's real path, which compares equal to other real paths. Git
 * prints `C:/...` on Windows, where Node paths use backslashes.
 */
export async function gitRepositoryRoot(cwd: string) {
  try {
    return await realpath(
      (
        await git(
          cwd,
          ["rev-parse", "--show-toplevel"],
          // Keeps Git's messages readable by `gitWorkTreeRoot`.
          { LC_ALL: "C" },
          undefined,
          ROOT_PROBE_TIMEOUT_MS,
        )
      ).trim(),
    );
  } catch (error) {
    throw probeError(error);
  }
}

function probeError(error: unknown) {
  return error instanceof Error && "killed" in error && error.killed
    ? new Error(
        `Git repository validation did not finish within ${ROOT_PROBE_TIMEOUT_MS / 1000} seconds. Please retry.`,
        { cause: error },
      )
    : error;
}

/**
 * The work tree containing `cwd`, or undefined only when Git reports that it
 * has none. Any other failure still throws, because a failed probe must never
 * downgrade a real repository to a plain folder. That includes a `.git` file
 * whose target is missing, which Git reports without the "(or any" wording.
 */
export async function gitWorkTreeRoot(cwd: string) {
  try {
    return await gitRepositoryRoot(cwd);
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr);
    if (stderr.includes("not a git repository (or any")) return undefined;
    throw error;
  }
}

export const WORKTREE_NEEDS_GIT =
  "Worktrees need a Git repository with at least one commit.";

/** What Git can do for a folder: whether it has a work tree and a commit. */
export async function gitState(cwd: string): Promise<GitState> {
  if ((await gitWorkTreeRoot(cwd)) === undefined) return "none";

  try {
    await git(
      cwd,
      ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
      undefined,
      undefined,
      ROOT_PROBE_TIMEOUT_MS,
    );

    return "ready";
  } catch (error) {
    // With --quiet, Git reports only a missing commit by exiting with 1.
    if ((error as { code?: unknown }).code === 1) return "no_commits";
    throw probeError(error);
  }
}

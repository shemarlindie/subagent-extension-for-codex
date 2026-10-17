import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

/** Bound the read-only Git probe without limiting worktree writes or snapshots. */
export async function gitRepositoryRoot(cwd: string) {
  try {
    return (
      await git(
        cwd,
        ["rev-parse", "--show-toplevel"],
        undefined,
        undefined,
        ROOT_PROBE_TIMEOUT_MS,
      )
    ).trim();
  } catch (error) {
    if (error instanceof Error && "killed" in error && error.killed) {
      throw new Error(
        `Git repository validation did not finish within ${ROOT_PROBE_TIMEOUT_MS / 1000} seconds. Please retry.`,
        { cause: error },
      );
    }

    throw error;
  }
}

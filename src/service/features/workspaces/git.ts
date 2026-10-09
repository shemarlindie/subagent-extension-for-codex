import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

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

/** Git output as bytes, for file contents that may be binary. */
export async function gitBytes(cwd: string, args: string[]) {
  return (
    await exec("git", ["-C", cwd, ...args], {
      encoding: "buffer",
      maxBuffer: 1024 * 1024 * 1024,
    })
  ).stdout;
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

const script = `try
  set selectedFolder to choose folder with prompt "Choose a Git repository to add to Delegated work"
  return POSIX path of selectedFolder
on error number -128
  return ""
end try`;

let pending = false;

/** Runs on the service host. Selection alone never grants repository access. */
export async function browseProject(
  options = { platform: process.platform as string, execute },
) {
  if (options.platform !== "darwin")
    throw new Error(
      "Folder browsing is available on macOS. Enter an absolute repository path instead.",
    );
  if (pending)
    throw new Error("A folder picker is already open on the service host.");
  pending = true;

  try {
    const { stdout } = await options.execute(
      "/usr/bin/osascript",
      ["-e", script],
      {
        timeout: 120000,
        maxBuffer: 16384,
      },
    );

    // osascript appends one line ending; preserve spaces in directory names.
    const repository = stdout.replace(/\r?\n$/, "");

    return { repository: repository || null };
  } finally {
    pending = false;
  }
}

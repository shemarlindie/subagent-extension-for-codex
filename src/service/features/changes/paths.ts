import { realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

/**
 * Resolve missing targets through their nearest existing parent, including
 * deleted files. The native call returns stored letter case on
 * case-insensitive file systems, so `.GIT` resolves to `.git`.
 */
function canonical(path: string): string {
  try {
    return realpathSync.native(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;

    return join(canonical(parent), basename(path));
  }
}

/** Tool paths are canonical workspace-relative paths, excluding Git metadata. */
export function changePath(workspace: string, path: string) {
  const root = realpathSync.native(workspace);
  const target = canonical(resolve(workspace, path));
  const rel = relative(root, target);

  if (
    !rel ||
    rel === ".." ||
    rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(rel) ||
    rel.split(/[\\/]/).includes(".git")
  ) {
    return undefined;
  }

  return rel.split(sep).join("/");
}

const missing = (error: unknown) =>
  ["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "");

/**
 * The absolute path of a regular file in a task workspace, for the host to
 * open. `path` is workspace-relative or absolute. Rejects paths outside the
 * workspace or in Git metadata, after resolving symlinks. The host opens the
 * path later, so a worker that changes the workspace in between can move
 * what it names.
 */
export async function workspaceFilePath(
  workspace: string | undefined,
  path: string,
) {
  if (!workspace) throw new Error("The task has no workspace yet.");
  let relative: string | undefined;

  try {
    relative = changePath(workspace, path);
  } catch (error) {
    if (!missing(error)) throw error;
    throw new Error("The task workspace was removed.", { cause: error });
  }

  if (relative === undefined) {
    throw new Error(
      `${path} is outside the task workspace or in Git metadata.`,
    );
  }

  const absolute = join(realpathSync.native(workspace), relative);

  const info = await stat(absolute).catch((error: unknown) => {
    if (missing(error)) throw new Error(`${relative} doesn't exist.`);
    throw error;
  });

  if (!info.isFile()) throw new Error(`${relative} isn't a file.`);

  return absolute;
}

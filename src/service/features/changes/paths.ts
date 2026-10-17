import { realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

/** Resolve missing targets through their nearest existing parent, including deleted files. */
function canonical(path: string): string {
  try {
    return realpathSync(path);
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
  const root = realpathSync(workspace);
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

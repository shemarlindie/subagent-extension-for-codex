import { lstat, realpath } from "node:fs/promises";
import { join, parse, resolve, sep } from "node:path";

import type { PathSymlink } from "../../../shared/filesystem/path-contract.js";

/** Identifies links in the original path, including parents of missing files. */
export async function pathSymlinks(path: string): Promise<PathSymlink[]> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const links: PathSymlink[] = [];
  let current = root;

  for (const part of absolute.slice(root.length).split(sep)) {
    current = join(current, part);
    let entry;

    try {
      entry = await lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }

    if (entry.isSymbolicLink()) {
      links.push({ path: current, target: await realpath(current) });
    }
  }

  return links;
}

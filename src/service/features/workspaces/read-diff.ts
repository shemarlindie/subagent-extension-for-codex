import { changedFiles, diffParts } from "../../../shared/workspaces/changes.js";
import { git } from "./git.js";

/**
 * Runs Git for the changes between two trees: every changed file with its
 * stats, and the unified diff split into one part per file, in the same order.
 */
export async function readDiff(cwd: string, base: string, current: string) {
  const diff = (...args: string[]) =>
    git(cwd, [
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

  const files = changedFiles(nameStatus, numstat);

  // Binary files have no line counts, so the list shows their size instead,
  // read for all of them at once: "<mode> blob <id> <size>\t<path>".
  const binary = files.filter(
    (file) => file.binary && file.status !== "deleted",
  );

  if (binary.length) {
    const sizes = new Map(
      (
        await git(cwd, [
          "ls-tree",
          "-r",
          "-l",
          "-z",
          current,
          "--",
          ...binary.map((file) => file.path),
        ])
      )
        .split("\0")
        .filter(Boolean)
        .map((entry) => {
          const [meta, path] = entry.split("\t"),
            size = meta?.trim().split(/\s+/)[3];

          if (path === undefined || size === undefined) {
            throw new Error("Malformed Git tree listing");
          }

          return [path, Number(size)] as const;
        }),
    );

    for (const file of binary) file.size = sizes.get(file.path);
  }

  return { files, parts: diffParts(patch) };
}

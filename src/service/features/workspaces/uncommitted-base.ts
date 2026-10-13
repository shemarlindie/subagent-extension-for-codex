import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { git } from "./git.js";

/**
 * Builds the tree uncommitted changes since `start` are measured from: the
 * `start` snapshot with the files committed since laid over it, as HEAD has
 * them now (see `TaskChanges`). Writes through a temporary index under
 * `root`, so the checkout's own index isn't touched.
 */
export async function buildUncommittedBase(
  root: string,
  cwd: string,
  start: string,
  headThen: string,
  headNow: string,
) {
  const tree = async (rev: string) =>
    (await git(cwd, ["rev-parse", "--verify", `${rev}^{tree}`])).trim();

  const [startTree, thenTree] = await Promise.all([
    tree(start),
    tree(headThen),
  ]);

  // Nothing committed since, or nothing uncommitted at the start.
  if (thenTree === headNow) return startTree;
  if (startTree === thenTree) return headNow;

  // "<mode> <mode> <id> <id> <status>", then the path; a deleted file's new
  // mode is 000000, which removes it from the index.
  const raw = (
    await git(cwd, [
      "diff",
      "--raw",
      "-z",
      "--no-renames",
      "--no-abbrev",
      thenTree,
      headNow,
      "--",
    ])
  ).split("\0");

  const entries: string[] = [];

  for (let index = 0; index + 1 < raw.length; index += 2) {
    const record = raw[index],
      path = raw[index + 1],
      [, mode, , id] = record?.slice(1).split(" ") ?? [];

    if (path === undefined || mode === undefined || id === undefined) {
      throw new Error("Malformed Git raw diff output");
    }

    entries.push(`${mode} ${id}\t${path}`);
  }

  // In a temporary index, the start snapshot with the committed files laid
  // over it, written as a tree. The checkout's own index isn't touched.
  await mkdir(root, { recursive: true, mode: 0o700 });
  const dir = await mkdtemp(join(root, ".baseline-"));
  const env = { GIT_INDEX_FILE: join(dir, "index") };

  try {
    await git(cwd, ["read-tree", startTree], env);

    await git(
      cwd,
      ["update-index", "-z", "--index-info"],
      env,
      entries.map((entry) => `${entry}\0`).join(""),
    );

    return (await git(cwd, ["write-tree"], env)).trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

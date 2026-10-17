import { type Task } from "../../../shared/tasks/model.js";
import { type ChangeScope } from "../../../shared/workspaces/changes.js";
import { git } from "./git.js";

// Where a task's changes start and end.

/** A worktree task's base commit, or a current_repo task's start snapshot. */
function taskBase(t: Task) {
  if (t.workspace_strategy === "worktree") return t.branch && t.base_commit;

  return t.start_tree;
}

/**
 * What a scope's changes are measured from: a worktree's base commit or a
 * current_repo task's start snapshot for the whole task, the turn snapshot
 * for the latest turn.
 */
export function changesBase(t: Task, scope: ChangeScope) {
  const base = scope === "turn" ? t.turn_start_tree : taskBase(t);

  // Without its starting snapshot, there is nothing to compare against.
  if (!base) {
    throw new Error(
      "This task has no change snapshot, so its changes aren't available.",
    );
  }

  return base;
}

/** The tree of a commit, by default the checkout's HEAD. */
export async function commitTree(cwd: string, commit = "HEAD") {
  return (
    await git(cwd, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${commit}^{tree}`,
    ])
  ).trim();
}

/**
 * Where a current_repo task's changes ended, and the commit HEAD was on
 * then, once it stopped: its turn ended or it waits for input. Undefined
 * while it runs, for a worktree, and for a task from before HEAD was
 * recorded with the end.
 */
export function endedAt(t: Task) {
  return t.workspace_strategy === "current_repo" && t.end_tree && t.end_head
    ? { tree: t.end_tree, head: t.end_head }
    : undefined;
}

/**
 * Of `paths`, those some commit since `head` gave the content `tree` has
 * for them, or deleted where `tree` has none: the task's content reached
 * HEAD, even if later commits changed it again.
 */
export async function committedSince(
  cwd: string,
  head: string,
  tree: string,
  paths: string[],
) {
  const committed = new Set<string>();
  if (!paths.length) return committed;

  const run = (...args: string[]) =>
    git(cwd, [
      "--literal-pathspecs",
      "-c",
      "core.quotePath=false",
      ...args,
      "--",
      ...paths,
    ]);

  const [log, listing] = await Promise.all([
    run(
      "log",
      "--raw",
      "--no-abbrev",
      "--no-renames",
      "--format=",
      "-z",
      `${head}..HEAD`,
    ),
    run("ls-tree", "-z", tree),
  ]);

  // "<mode> blob <id>\t<path>"
  const ids = new Map<string, string | undefined>();

  for (const entry of listing.split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    ids.set(entry.slice(tab + 1), entry.slice(0, tab).split(" ")[2]);
  }

  // ":<mode> <mode> <id> <id> <status>", then the path.
  const fields = log.split("\0");

  for (let index = 0; index + 1 < fields.length; index++) {
    const record = fields[index];
    if (!record?.startsWith(":")) continue;

    const path = fields[++index]!,
      [, , , id, status] = record.slice(1).split(" "),
      end = ids.get(path);

    if (end === undefined ? status === "D" : id === end) committed.add(path);
  }

  return committed;
}

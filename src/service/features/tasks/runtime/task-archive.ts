import { logError } from "../../../platform/logging/logger.js";
import type { Control } from "./control.js";
import { removeTaskWorktree, type WorktreeContext } from "./task-worktree.js";
import { recordTaskTiming } from "./timing.js";

type ArchiveContext = Pick<Control, "archive" | "stopped"> & WorktreeContext;

/**
 * Archives or unarchives tasks. Archiving then removes each archived task's
 * worktree in the background when it has no uncommitted changes, keeping the
 * branch. `cleanup` settles once every removal finishes, fails or is skipped.
 */
export function setTasksArchived(
  c: ArchiveContext,
  owner: string,
  ids: string[],
  archived: boolean,
) {
  const result = c.archive.setArchived(owner, ids, archived);

  const cleanup = archived
    ? removeWorktrees(c, owner, result.task_ids)
    : Promise.resolve();

  return { result, cleanup };
}

/**
 * Removes the tasks' clean worktrees one at a time, until shutdown. Nothing
 * awaits it in production, so each task's failure is logged and never thrown.
 */
async function removeWorktrees(
  c: ArchiveContext,
  owner: string,
  ids: string[],
) {
  const started = performance.now();
  let worktrees = 0;
  let removed = 0;

  for (const id of ids) {
    if (c.stopped) break;

    try {
      // The task can be deleted while earlier worktrees are removed, or have
      // a removal running from an earlier archive.
      const t = c.store.find(id, owner);

      if (
        t?.workspace_strategy !== "worktree" ||
        !t.workspace ||
        t.workspace_removed ||
        c.worktreeChanges.has(id)
      ) {
        continue;
      }

      worktrees++;
      const { status } = await removeTaskWorktree(c, owner, id);
      if (status === "removed") removed++;
    } catch (error) {
      logError("task.archive_worktree_removal_failed", error, { task_id: id });
    }
  }

  if (!worktrees) return;

  recordTaskTiming({
    phase: "archive_cleanup",
    duration_ms: performance.now() - started,
    worktree_count: worktrees,
    removed_count: removed,
  });
}

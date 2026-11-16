import { logError } from "../../../platform/logging/logger.js";
import type { Control } from "./control.js";
import { removeTaskWorktree, type WorktreeContext } from "./task-worktree.js";

type ArchiveContext = Pick<Control, "archive"> & WorktreeContext;

/**
 * Archives or unarchives tasks. Archiving also removes each archived task's
 * worktree when it has no uncommitted changes, keeping the branch. A worktree
 * that can't be removed stays, and the archive still applies.
 */
export async function setTasksArchived(
  c: ArchiveContext,
  owner: string,
  ids: string[],
  archived: boolean,
) {
  const result = c.archive.setArchived(owner, ids, archived);
  if (!archived) return result;

  for (const id of result.task_ids) {
    // The task can be deleted while earlier worktrees are removed.
    const t = c.store.find(id, owner);

    if (
      !t ||
      t.workspace_strategy !== "worktree" ||
      !t.workspace ||
      t.workspace_removed
    ) {
      continue;
    }

    await removeTaskWorktree(c, owner, id).catch((error: unknown) => {
      logError("task.archive_worktree_removal_failed", error, { task_id: id });
    });
  }

  return result;
}

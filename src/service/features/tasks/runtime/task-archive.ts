import { logError } from "../../../platform/logging/logger.js";
import type { Control } from "./control.js";

type ArchiveContext = Pick<Control, "archive" | "store" | "removeWorktree">;

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
    const t = c.store.get(id, owner);

    if (
      t.workspace_strategy !== "worktree" ||
      !t.workspace ||
      t.workspace_removed
    ) {
      continue;
    }

    await c.removeWorktree(owner, id).catch((error: unknown) => {
      logError("task.archive_worktree_removal_failed", error, { task_id: id });
    });
  }

  return result;
}

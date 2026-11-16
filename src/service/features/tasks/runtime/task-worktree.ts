import type { Task } from "../../../../shared/tasks/model.js";
import type { Control } from "./control.js";

export type WorktreeContext = Pick<
  Control,
  "store" | "workspaces" | "worktreeChanges" | "idleWorktreeTask" | "schedule"
>;

/**
 * Runs a change to a stopped task's worktree or branch. Turns and deletion
 * wait for it, so a message sent meanwhile stays queued until it finishes.
 */
async function changeWorktree<T>(
  c: WorktreeContext,
  owner: string,
  id: string,
  change: (t: Task) => Promise<T>,
) {
  const running = change(c.idleWorktreeTask(owner, id));
  c.worktreeChanges.set(id, running);

  try {
    return await running;
  } finally {
    c.worktreeChanges.delete(id);
    void c.schedule();
  }
}

/**
 * Removes a task's worktree and keeps its branch. With uncommitted changes, it
 * removes nothing and lists them, unless `force` is set.
 */
export function removeTaskWorktree(
  c: WorktreeContext,
  owner: string,
  id: string,
  force = false,
) {
  return changeWorktree(c, owner, id, async (t) => {
    const result = await c.workspaces.removeWorktree(t, force);

    if (result.status === "removed") {
      // A message sent during the removal changed the stored task.
      const current = c.store.get(id, owner);
      current.workspace_removed = true;
      c.store.save(current);

      c.store.event(current, "task.worktree_removed", {
        path: current.workspace,
        branch: current.branch,
        forced: force,
      });
    }

    return result;
  });
}

/** Deletes a task's branch, once its worktree is removed. */
export function deleteTaskBranch(
  c: WorktreeContext,
  owner: string,
  id: string,
) {
  return changeWorktree(c, owner, id, async (t) => {
    await c.workspaces.deleteBranch(t);
    const current = c.store.get(id, owner);
    current.branch_deleted = true;
    c.store.save(current);
    c.store.event(current, "task.branch_deleted", { branch: current.branch });

    return { status: "deleted" as const };
  });
}

/** Waits for the tasks' worktree changes, whatever their outcome. */
export async function settleWorktreeChanges(
  c: Pick<Control, "worktreeChanges">,
  ids: Iterable<string>,
) {
  for (const id of ids) await c.worktreeChanges.get(id)?.catch(() => {});
}

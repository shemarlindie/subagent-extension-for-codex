import type { Task } from "../../../../shared/tasks/model.js";
import type { Control } from "./control.js";

export type WorktreeContext = Pick<
  Control,
  "store" | "workspaces" | "worktreeChanges" | "idleWorktreeTask" | "schedule"
>;

/**
 * The worktree and branch changes in progress, at most one per task. Turns,
 * deletion and shutdown wait for them.
 */
export class WorktreeChanges {
  private running = new Map<string, Promise<unknown>>();

  has(id: string) {
    return this.running.has(id);
  }

  /** Runs a task's change and records it until it settles. */
  async run<T>(id: string, change: () => Promise<T>) {
    const running = change();
    this.running.set(id, running);

    try {
      return await running;
    } finally {
      this.running.delete(id);
    }
  }

  /** Waits for the tasks' changes, or every change, whatever their outcome. */
  async settle(ids: Iterable<string> = this.running.keys()) {
    for (const id of [...ids]) await this.running.get(id)?.catch(() => {});
  }
}

/**
 * Runs a change to a stopped task's worktree or branch. A message sent
 * meanwhile stays queued, and its turn starts once the change finishes.
 */
async function changeWorktree<T>(
  c: WorktreeContext,
  owner: string,
  id: string,
  change: (t: Task) => Promise<T>,
) {
  const t = c.idleWorktreeTask(owner, id);

  try {
    return await c.worktreeChanges.run(id, () => change(t));
  } finally {
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

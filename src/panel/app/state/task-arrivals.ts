import type { Task } from "./types";

/** Finds tasks that appear between task-list reads of one scope, such as ones Codex starts. */
export class TaskArrivals {
  private listed?: { scope: number; ids: Set<string> };

  /** The newest unarchived task the previous read of this scope didn't list. */
  next(tasks: Task[], scope: number) {
    const listed = this.listed?.scope === scope ? this.listed.ids : undefined;
    this.listed = { scope, ids: new Set(tasks.map((task) => task.id)) };

    return listed
      ? tasks.find((task) => !listed.has(task.id) && !task.archived_at)
      : undefined;
  }
}

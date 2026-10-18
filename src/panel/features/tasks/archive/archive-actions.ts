import {
  archivable,
  type ArchiveResult,
} from "../../../../shared/tasks/archive.js";
import type { Snapshot, Task } from "../../../app/state/types";

interface ArchiveContext {
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  /** Closes the open task and returns to the task list. */
  leaveSelection(): void;
}

const EMPTY: ArchiveResult = { task_ids: [], skipped: [] };

/** Whether the user can archive or unarchive a task now. */
export const canToggleArchive = (task: Task) =>
  Boolean(task.archived_at) || archivable(task);

/**
 * Archives and unarchives tasks. Archived tasks leave the task list for their
 * project's archive on the Projects page, and archiving the open task closes it.
 * Like read state, these show at once without making the panel busy, and the
 * next refresh corrects anything a failure leaves behind.
 */
export class ArchiveActions {
  constructor(private context: ArchiveContext) {}

  /** Archives or unarchives tasks, leaving those already so and, when archiving, active ones. */
  async setArchived(tasks: Task[], archived: boolean): Promise<ArchiveResult> {
    const changing = tasks.filter((task) =>
      archived ? !task.archived_at && archivable(task) : task.archived_at,
    );

    if (!changing.length || this.context.closed()) return EMPTY;

    const { selected } = this.context.snapshot();

    if (archived && changing.some((task) => task.id === selected)) {
      this.context.leaveSelection();
    }

    return this.record(changing, archived, "set_user_agent_tasks_archived", {
      task_ids: changing.map((task) => task.id),
      archived,
    });
  }

  /** Unarchives an archived task, and archives any other. */
  toggle(task: Task) {
    return this.setArchived([task], !task.archived_at);
  }

  /** Shows `shown` changed at once, then what the service changed. */
  private async record(
    shown: Task[],
    archived: boolean,
    name: string,
    args: Record<string, unknown>,
  ) {
    const at = archived ? new Date().toISOString() : undefined;

    this.show(new Map(shown.map((task) => [task.id, at])));

    try {
      const result = await this.context.tool<ArchiveResult>(name, args);

      this.show(
        new Map([
          ...result.task_ids.map((id) => [id, at] as const),
          ...shown
            .filter((task) => !result.task_ids.includes(task.id))
            .map((task) => [task.id, task.archived_at] as const),
        ]),
      );

      return result;
    } catch (error) {
      this.show(new Map(shown.map((task) => [task.id, task.archived_at])));
      throw error;
    }
  }

  /** Replaces the listed tasks' archive times; undefined unarchives. */
  private show(times: Map<string, string | undefined>) {
    if (this.context.closed()) return;
    const { tasks } = this.context.snapshot();

    if (!tasks.some((task) => times.has(task.id))) return;

    this.context.patch({
      tasks: tasks.map((task) => {
        if (!times.has(task.id)) return task;
        const { archived_at: _archived, ...rest } = task;
        const at = times.get(task.id);

        return at ? { ...rest, archived_at: at } : rest;
      }),
    });
  }
}

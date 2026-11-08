import {
  archivable,
  type ArchiveResult,
} from "../../../../shared/tasks/archive.js";
import { tasksInScope } from "../../../app/state/scope-reconciliation";
import type { Snapshot, Task } from "../../../app/state/types";
import { quote, type UndoRecorder } from "../../../app/state/undo-history";

interface ArchiveContext {
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  /** Closes the open task and returns to the task list. */
  leaveSelection(): void;
  /** Opens a task, as choosing it in the list does. */
  select(id: string): Promise<void>;
  /** Remembers changes the user can undo. */
  undo: UndoRecorder;
}

const EMPTY: ArchiveResult = { task_ids: [], skipped: [] };

/** Whether the user can archive or unarchive a task now. */
export const canToggleArchive = (task: Task) =>
  Boolean(task.archived_at) || archivable(task);

/** The changed tasks' titles, in the order the service listed them. */
const titles = (tasks: Task[], ids: string[]) =>
  ids.map((id) => tasks.find((t) => t.id === id)?.title ?? id);

/** Names the archived tasks for the undo toast. */
function archiveLabel(tasks: Task[], ids: string[], archived: boolean) {
  const verb = archived ? "Archived" : "Unarchived",
    title = ids.length === 1 && tasks.find((t) => t.id === ids[0])?.title;

  if (title) return `${verb} ${quote(title)}`;

  return `${verb} ${ids.length} tasks`;
}

/**
 * Archives and unarchives tasks. Archived tasks leave the task list for their
 * project's archive on the Projects page, and archiving the open task closes it.
 * Like read state, these show at once without making the panel busy, and the
 * next refresh corrects anything a failure leaves behind. Undo reverses what
 * the service changed, and reopens a task that archiving closed.
 */
export class ArchiveActions {
  constructor(private context: ArchiveContext) {}

  /** Archives or unarchives tasks, leaving those already so and, when archiving, active ones. */
  async setArchived(tasks: Task[], archived: boolean): Promise<ArchiveResult> {
    const changing = tasks.filter((task) =>
      archived ? !task.archived_at && archivable(task) : task.archived_at,
    );

    if (!changing.length || this.context.closed()) return EMPTY;

    const { selected } = this.context.snapshot(),
      ids = changing.map((task) => task.id),
      closed = archived && selected && ids.includes(selected) ? selected : "";

    const action = this.apply(ids, archived, changing);

    // The undo reverses only what the service changed.
    const changed = async () => (await action).task_ids;

    this.context.undo.track(
      action,
      {
        label: archiveLabel(changing, ids, archived),
        // The tasks leave the list, so the change shows a toast.
        toast: true,
        ...(ids.length > 1 ? { items: titles(changing, ids) } : {}),
        undo: async () => {
          const reverted = await changed();
          if (archived) this.relist(changing, reverted);
          await this.apply(reverted, !archived);

          // Only a task the current scope lists can open.
          const listed = this.context
            .snapshot()
            .tasks.some((task) => task.id === closed);

          if (listed && reverted.includes(closed)) {
            await this.context.select(closed);
          }
        },
        redo: async () => {
          await this.apply(await changed(), archived);
        },
      },
      (result) => result.task_ids.length > 0,
    );

    return action;
  }

  /** Unarchives an archived task, and archives any other. */
  toggle(task: Task) {
    return this.setArchived([task], !task.archived_at);
  }

  /**
   * Shows the tasks changed at once, then what the service changed. `shown`
   * holds the tasks as they were, defaulting to those the list has.
   */
  private async apply(
    ids: string[],
    archived: boolean,
    shown = this.context.snapshot().tasks.filter((t) => ids.includes(t.id)),
  ) {
    const at = archived ? new Date().toISOString() : undefined;

    if (archived && ids.includes(this.context.snapshot().selected ?? "")) {
      this.context.leaveSelection();
    }

    this.show(new Map(ids.map((id) => [id, at])));

    try {
      const result = await this.context.tool<ArchiveResult>(
        "app_set_tasks_archived",
        { task_ids: ids, archived },
      );

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

  /**
   * Lists archived tasks again, still archived, once a refresh has dropped
   * them, so unarchiving shows them at once.
   */
  private relist(tasks: Task[], ids: string[]) {
    if (this.context.closed()) return;
    const state = this.context.snapshot();

    const dropped = tasksInScope(tasks, state).filter(
      (task) =>
        ids.includes(task.id) && !state.tasks.some((t) => t.id === task.id),
    );

    if (!dropped.length) return;
    const at = new Date().toISOString();

    this.context.patch({
      tasks: [
        ...state.tasks,
        ...dropped.map((task) => ({ ...task, archived_at: at })),
      ].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    });
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

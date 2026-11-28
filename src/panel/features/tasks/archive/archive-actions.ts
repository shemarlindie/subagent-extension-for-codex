import {
  archivable,
  type ArchiveResult,
} from "../../../../core/shared/tasks/archive.js";
import { tasksInScope } from "../../../app/state/scope-reconciliation";
import type { Snapshot, Task } from "../../../app/state/types";
import {
  quote,
  type UndoEntry,
  type UndoRecorder,
} from "../../../app/state/undo-history";
import { errorMessage } from "../../../shared/utils/error-message";
import {
  settleTaskBatches,
  TASK_BATCH_LIMIT,
  taskBatchWarning,
  type TaskBatchFailure,
} from "../controls/task-batches";

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

type ArchiveOutcome = ArchiveResult & { failure?: TaskBatchFailure };

const EMPTY: ArchiveOutcome = { task_ids: [], skipped: [] };

/** Whether the user can archive or unarchive a task now. */
export const canToggleArchive = (task: Task) =>
  Boolean(task.archived_at) || archivable(task);

/** The changed tasks' titles, in the order the service listed them. */
const titles = (tasks: Task[], ids: string[]) =>
  ids.map((id) => tasks.find((t) => t.id === id)?.title ?? id);

/** Names the archived tasks for the undo toast. */
function archiveLabel(tasks: Task[], ids: string[], archived: boolean) {
  const verb = archived ? "Archived" : "Unarchived";
  const title = ids.length === 1 && tasks.find((t) => t.id === ids[0])?.title;

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
  async setArchived(tasks: Task[], archived: boolean): Promise<ArchiveOutcome> {
    const eligible = (task: Task) =>
      archived ? !task.archived_at && archivable(task) : task.archived_at;

    if (!tasks.some(eligible) || this.context.closed()) return EMPTY;

    /** The tasks as they were when the change ran. */
    let changing: Task[] = [];
    /** The open task archiving closes, which undo reopens. */
    let closed = "";
    /** The tasks the last step changed, which the next one reverses. */
    let reversible: string[] = [];

    const replay = async (archive: boolean) => {
      if (!archive) this.relist(changing, reversible);

      const result = await this.apply(reversible, archive);
      const warning = taskBatchWarning(result.skipped.length, result.failure);

      if (!result.task_ids.length) {
        throw new Error(warning || "No tasks could be changed.");
      }

      changed(result.task_ids);

      const reopen =
        !archive &&
        reversible.includes(closed) &&
        tasksInScope(
          changing.filter((task) => task.id === closed),
          this.context.snapshot(),
        ).length > 0;

      if (reopen) {
        try {
          await this.context.select(closed);
        } catch (error) {
          return {
            warning: [warning, errorMessage(error)].filter(Boolean).join(" "),
          };
        }
      }

      return warning ? { warning } : undefined;
    };

    const entry: UndoEntry = {
      label: "",
      toast: true,
      undo: () => replay(!archived),
      redo: () => replay(archived),
    };

    const changed = (ids: string[]) => {
      reversible = ids;

      Object.assign(entry, {
        label: archiveLabel(changing, ids, archived),
        items: ids.length > 1 ? titles(changing, ids) : undefined,
      });
    };

    return this.context.undo.change(
      async () => {
        const state = this.context.snapshot();

        // Earlier changes may have changed these tasks while this one waited.
        changing = tasks
          .map((task) => state.tasks.find((t) => t.id === task.id) ?? task)
          .filter(eligible);

        if (!changing.length) return EMPTY;
        const ids = changing.map((task) => task.id);

        if (archived && state.selected && ids.includes(state.selected)) {
          closed = state.selected;
        }

        return this.apply(ids, archived, changing);
      },
      (result) => {
        if (!result.task_ids.length) return undefined;
        changed(result.task_ids);

        return entry;
      },
    );
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
    const { selected } = this.context.snapshot();
    const open = archived && selected && ids.includes(selected) ? selected : "";

    this.show(new Map(ids.map((id) => [id, at])));

    const { changed, failure } = await settleTaskBatches(
      ids,
      TASK_BATCH_LIMIT,
      (batch) =>
        this.context.tool<ArchiveResult>("app_set_tasks_archived", {
          task_ids: batch,
          archived,
        }),
    );

    const task_ids = changed.flatMap((result) => result.task_ids);
    const skipped = changed.flatMap((result) => result.skipped);
    const applied = new Set(task_ids);

    this.show(
      new Map([
        ...shown
          .filter((task) => !applied.has(task.id))
          .map((task) => [task.id, task.archived_at] as const),
        ...task_ids.map((id) => [id, at] as const),
      ]),
    );

    // Closes the open task only once the service archives it, and only if
    // the user hasn't opened another meanwhile.
    if (
      applied.has(open) &&
      !this.context.closed() &&
      this.context.snapshot().selected === open
    ) {
      this.context.leaveSelection();
    }

    if (failure && !changed.length) throw failure.error;

    return { task_ids, skipped, ...(failure ? { failure } : {}) };
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

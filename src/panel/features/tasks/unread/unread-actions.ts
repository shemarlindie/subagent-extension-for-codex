import type { ReadState } from "../../../../shared/tasks/conversation/unread.js";
import type { NewMark, Snapshot, Task } from "../../../app/state/types";
import {
  quote,
  type UndoEntry,
  type UndoRecorder,
} from "../../../app/state/undo-history";
import { chunks } from "../../../shared/utils/chunks";
import {
  settleTaskBatches,
  TASK_BATCH_LIMIT,
  taskBatchWarning,
  type TaskBatchFailure,
} from "../controls/task-batches";

interface UnreadContext {
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  report(error: unknown): void;
  /** Remembers changes the user can undo. */
  undo: UndoRecorder;
}

/** A task's read fields as the list shows them; empty once it's read. */
type ReadFields = Pick<Task, "unread" | "read_through">;

const fieldsFrom = (state: ReadState): ReadFields =>
  state.unread ? { unread: true, read_through: state.through } : {};

const fieldsOf = (task: Task): ReadFields =>
  task.unread ? { unread: true, read_through: task.read_through } : {};

type ReadOutcome = { changed: Task[]; failure?: TaskBatchFailure };

function readLabel(tasks: Task[], read: boolean) {
  const title = tasks.length === 1 && tasks[0]?.title;
  const target = title ? quote(title) : `${tasks.length} tasks`;

  return `Marked ${target} ${read ? "read" : "unread"}`;
}

/** Limits concurrent requests for read actions the service takes one task at a time. */
async function changeReadState(
  tasks: Task[],
  apply: (task: Task) => Promise<void>,
): Promise<ReadOutcome> {
  const changed: Task[] = [];
  let failure: TaskBatchFailure | undefined;

  for (const batch of chunks(tasks, 16)) {
    const results = await Promise.allSettled(batch.map(apply));

    batch.forEach((task, index) => {
      const result = results[index];

      if (result?.status === "fulfilled") {
        changed.push(task);
      } else if (result?.status === "rejected") {
        failure ??= { count: 0, error: result.reason };
        failure.count++;
      }
    });
  }

  return { changed, failure };
}

/**
 * Records what the user has read of their tasks. Reading a task's Chat to
 * its end marks it read; the user can also mark tasks read or unread. These run
 * beside other actions without making the panel busy, and the next refresh
 * corrects anything a failure leaves behind. The user's own changes can be
 * undone, which puts back each task's read point and "New" divider. Reading
 * a Chat to its end is never recorded.
 */
export class UnreadActions {
  /**
   * A task the user marked unread while it was open. Reading it doesn't mark
   * it read again until they scroll its Chat to or from the end, or open another
   * task.
   */
  private held?: string;
  /** The open task while its Chat is on screen at the latest message. */
  private watched?: string;
  /** The Chat cursor each task was last read through, so repeated renders send it once. */
  private sent = new Map<string, number>();
  /**
   * The service's read point for a watched task that `settle` shows as read,
   * until Chat reads past it and `readThrough` records that.
   */
  private settled = new Map<string, number>();

  constructor(private context: UnreadContext) {}

  /**
   * Records the user reading a task's Chat through event `through`, its
   * cursor. A failure stays quiet: reading happens in the background, and
   * the next render after a refresh tries again.
   */
  async readThrough(task: Task, through: number) {
    const settled = this.settled.get(task.id);

    if (
      !(task.unread || (settled !== undefined && settled < through)) ||
      this.held === task.id ||
      this.sent.get(task.id) === through ||
      this.context.closed()
    ) {
      return;
    }

    this.sent.set(task.id, through);
    this.settled.delete(task.id);

    try {
      const result = await this.context.tool<ReadState>("app_set_task_read", {
        task_id: task.id,
        read: true,
        through,
      });

      this.show(new Map([[task.id, fieldsFrom(result)]]));
    } catch {
      this.sent.delete(task.id);
      if (settled !== undefined) this.settled.set(task.id, settled);
    }
  }

  /** Sets the task whose Chat is on screen at its latest message, if any. */
  watch(taskId: string | undefined) {
    this.watched = taskId;
  }

  /**
   * Keeps the watched task read in a task-list fetch, so new messages don't
   * flash it unread before Chat reads them and `readThrough` records them.
   */
  settle(tasks: Task[]): Task[] {
    const id = this.watched;
    const task = id && tasks.find((item) => item.id === id && item.unread);
    if (!task || this.held === id) return tasks;

    this.settled.set(id, task.read_through ?? 0);

    return tasks.map((item) => {
      if (item !== task) return item;
      const { unread: _unread, read_through: _through, ...rest } = item;

      return rest;
    });
  }

  /** Ends a hold once the user moves through the held task's Chat or opens another task. */
  release(taskId: string) {
    if (this.held === taskId) this.held = undefined;
  }

  /** Marks a task read, clearing the open task's "New" divider. */
  markRead(task: Task) {
    return this.remember(task, () => this.read(task), {
      label: `Marked ${quote(task.title)} read`,
      redo: () => this.read(task),
    });
  }

  private async read(task: Task) {
    this.release(task.id);
    const previous = this.clearDivider([task.id]);

    try {
      await this.mark(task, true);
    } catch (error) {
      this.moveDivider(previous);
      throw error;
    }
  }

  /** Marks a task unread; while it stays open and unscrolled, reading it doesn't mark it read again. */
  markUnread(task: Task) {
    return this.remember(
      task,
      () => this.unread(task),
      {
        label: `Marked ${quote(task.title)} unread`,
        redo: () => this.unread(task),
      },
      (before) =>
        before.unread ? this.restore(task, before) : this.clearUnreadMark(task),
    );
  }

  private async unread(task: Task) {
    if (task.id === this.context.snapshot().selected) this.held = task.id;

    try {
      await this.mark(task, false);
    } catch (error) {
      this.release(task.id);
      throw error;
    }
  }

  /** Clears the manual unread flag without advancing the stored cursor. */
  private async clearUnreadMark(task: Task) {
    await this.mark(task, true, 0);
    this.release(task.id);
  }

  /**
   * Marks a task unread from event `from` on, so that message and the ones
   * after it are new. Like `markUnread`, an open task stays unread while the user reads it.
   */
  markUnreadFrom(task: Task, from: number) {
    return this.remember(task, () => this.unreadFrom(task, from), {
      label: `Marked ${quote(task.title)} unread from a reply`,
      redo: () => this.unreadFrom(task, from),
    });
  }

  private async unreadFrom(task: Task, from: number, restore?: ReadFields) {
    const { selected, newMark: previous } = this.context.snapshot();
    const open = task.id === selected;
    const showDivider = open || !restore;
    const previousHold = this.held;

    if (open) this.held = task.id;
    if (showDivider) this.markDivider(task.id, from - 1);

    const optimistic = this.context.snapshot().newMark;

    try {
      const state = await this.record(
        task,
        restore ?? { unread: true },
        "app_mark_task_unread_from",
        { task_id: task.id, event_id: from },
      );

      // Undo also restores a manual unread flag on a task without unseen replies.
      if (restore && state && !state.unread) await this.mark(task, false);
    } catch (error) {
      const current = this.context.snapshot();

      if (
        showDivider &&
        current.selected === selected &&
        current.newMark === optimistic
      ) {
        if (this.held === task.id) this.held = previousHold;
        this.moveDivider(previous);
      }

      throw error;
    }
  }

  /** Marks an unread task read, and any other task unread. */
  toggle(task: Task) {
    return task.unread ? this.markRead(task) : this.markUnread(task);
  }

  /** Marks everything so far in these tasks read. */
  async markAllRead(tasks: Task[]) {
    const { failure } = await this.setMany(tasks, true);
    if (failure) throw failure.error;
  }

  /** Changes the eligible tasks' read state as one undo step. */
  async setMany(tasks: Task[], read: boolean): Promise<ReadOutcome> {
    const eligible = (task: Task) => Boolean(task.unread) === read;
    if (!tasks.some(eligible) || this.context.closed()) return { changed: [] };

    const apply = (tasks: Task[]) =>
      read
        ? this.allRead(tasks)
        : changeReadState(tasks, (task) => this.unread(task));

    /** The tasks the last step changed, which the next one reverses. */
    let reversible: Task[] = [];

    const restore = (tasks: Task[]) =>
      changeReadState(tasks, (task) =>
        read ? this.restore(task, fieldsOf(task)) : this.clearUnreadMark(task),
      );

    const replay = async (step: (tasks: Task[]) => Promise<ReadOutcome>) => {
      const { changed: tasks, failure } = await step(reversible);
      if (failure && !tasks.length) throw failure.error;
      changed(tasks);

      return failure ? { warning: taskBatchWarning(0, failure) } : undefined;
    };

    const entry: UndoEntry = {
      label: "",
      toast: true,
      undo: () => replay(restore),
      redo: () => replay(apply),
    };

    const changed = (tasks: Task[]) => {
      reversible = tasks;

      Object.assign(entry, {
        label: readLabel(tasks, read),
        items: tasks.length > 1 ? tasks.map((task) => task.title) : undefined,
      });
    };

    return this.context.undo.change(
      async () => {
        const changing = tasks.map(this.current).filter(eligible);

        return changing.length ? apply(changing) : { changed: [] };
      },
      (outcome) => {
        if (!outcome.changed.length) return undefined;
        changed(outcome.changed);

        return entry;
      },
    );
  }

  private async allRead(unread: Task[]): Promise<ReadOutcome> {
    const ids = unread.map((task) => task.id);
    const held = this.held;
    const stateBefore = this.context.snapshot();
    const before = new Map(stateBefore.tasks.map((task) => [task.id, task]));
    const previous = this.clearDivider(ids);
    const cleared = this.context.snapshot().newMark;
    this.show(new Map(ids.map((id) => [id, {}])));

    const { changed, failed, failure } = await settleTaskBatches(
      unread,
      TASK_BATCH_LIMIT,
      async (batch) => {
        await this.context.tool("app_mark_tasks_read", {
          task_ids: batch.map((task) => task.id),
        });

        return batch;
      },
    );

    const state = this.context.snapshot();

    if (
      stateBefore.scopeVersion === state.scopeVersion &&
      stateBefore.selected === state.selected &&
      state.newMark === cleared
    ) {
      if (failed.some((task) => task.id === state.selected)) {
        this.moveDivider(previous);
      } else if (held && held === state.selected && ids.includes(held)) {
        this.release(held);
      }
    }

    if (failure) {
      this.show(
        new Map(
          failed.map((task) => [
            task.id,
            fieldsOf(before.get(task.id) ?? task),
          ]),
        ),
      );
    }

    return { changed: changed.flat(), failure };
  }

  /**
   * Changes one task and remembers it. Undo puts back the read state the task
   * had when the change ran, by default.
   */
  private remember(
    task: Task,
    start: () => Promise<void>,
    steps: Pick<UndoEntry, "label" | "redo">,
    undo = (before: ReadFields) => this.restore(task, before),
  ) {
    let before: ReadFields = {};

    return this.context.undo.change(
      () => {
        before = fieldsOf(this.current(task));

        return start();
      },
      () => ({ ...steps, undo: () => undo(before) }),
    );
  }

  /** The task as the list shows it now, which may be newer than `task`. */
  private current = (task: Task) =>
    this.context.snapshot().tasks.find((item) => item.id === task.id) ?? task;

  /**
   * Puts back a task's read fields: unread from just after its read point, or
   * read. An open task gets its "New" divider back and stays unread while
   * the user reads it, as after marking it unread.
   */
  private restore(task: Task, fields: ReadFields) {
    return fields.unread
      ? this.unreadFrom(task, (fields.read_through ?? 0) + 1, fields)
      : this.read(task);
  }

  private mark(task: Task, read: boolean, through?: number) {
    return this.record(
      task,
      read ? {} : { unread: true },
      "app_set_task_read",
      { task_id: task.id, read, ...(through === undefined ? {} : { through }) },
    );
  }

  /**
   * Shows the change at once, then what the service recorded. Until it
   * answers, a task marked unread has no marker, so it opens without a
   * "New" divider; the service's answer adds the marker.
   */
  private async record(
    task: Task,
    shown: ReadFields,
    name: string,
    args: Record<string, unknown>,
  ) {
    if (this.context.closed()) return;
    this.sent.delete(task.id);
    this.settled.delete(task.id);

    const current = this.context
      .snapshot()
      .tasks.find((item) => item.id === task.id);

    this.show(new Map([[task.id, shown]]));

    try {
      const result = await this.context.tool<ReadState>(name, args);

      this.show(new Map([[task.id, fieldsFrom(result)]]));

      return result;
    } catch (error) {
      this.show(new Map([[task.id, fieldsOf(current ?? task)]]));
      throw error;
    }
  }

  /**
   * Moves Chat's "New" divider in a task to just after event `through`, or
   * removes it without `through`, returning the mark this replaces.
   */
  private markDivider(task: string, through?: number) {
    const previous = this.context.snapshot().newMark;

    this.moveDivider({
      task,
      through,
      revision: (previous?.revision ?? 0) + 1,
    });

    return previous;
  }

  /**
   * Removes the open task's "New" divider when it is one of these tasks,
   * returning the mark this replaces. Only the open task's Chat shows a
   * divider; any other opens with its own.
   */
  private clearDivider(ids: string[]) {
    const { selected, newMark } = this.context.snapshot();

    return selected && ids.includes(selected)
      ? this.markDivider(selected)
      : newMark;
  }

  /** Moves Chat's "New" divider, or clears it with undefined. */
  private moveDivider(mark: NewMark | undefined) {
    if (this.context.closed() || this.context.snapshot().newMark === mark) {
      return;
    }

    this.context.patch({ newMark: mark });
  }

  /** Replaces the listed tasks' read fields. */
  private show(fields: Map<string, ReadFields>) {
    if (this.context.closed()) return;
    const { tasks } = this.context.snapshot();

    if (!tasks.some((task) => fields.has(task.id))) return;

    this.context.patch({
      tasks: tasks.map((task) => {
        const next = fields.get(task.id);
        if (!next) return task;
        const { unread: _unread, read_through: _through, ...rest } = task;

        return { ...rest, ...next };
      }),
    });
  }
}

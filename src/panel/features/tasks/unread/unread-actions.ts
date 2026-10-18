import type { ReadState } from "../../../../shared/tasks/conversation/unread.js";
import type { NewMark, Snapshot, Task } from "../../../app/state/types";

interface UnreadContext {
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  report(error: unknown): void;
}

/** A task's read fields as the list shows them; empty once it's read. */
type ReadFields = Pick<Task, "unread" | "read_through">;

const fieldsFrom = (state: ReadState): ReadFields =>
  state.unread ? { unread: true, read_through: state.through } : {};

const fieldsOf = (task: Task): ReadFields =>
  task.unread ? { unread: true, read_through: task.read_through } : {};

/**
 * Records what the user has read of their tasks. Reading a task's Chat to
 * its end marks it read; the user can also mark tasks read or unread. These run
 * beside other actions without making the panel busy, and the next refresh
 * corrects anything a failure leaves behind.
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
  async markRead(task: Task) {
    if (this.held === task.id) this.held = undefined;
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
    if (task.id === this.context.snapshot().selected) this.held = task.id;

    return this.mark(task, false);
  }

  /**
   * Marks a task unread from event `from` on, so that message and the ones
   * after it are new. Like `markUnread`, an open task stays unread while the user reads it.
   */
  async markUnreadFrom(task: Task, from: number) {
    if (task.id === this.context.snapshot().selected) this.held = task.id;

    const previous = this.markDivider(task.id, from - 1);

    try {
      await this.record(task, { unread: true }, "app_mark_task_unread_from", {
        task_id: task.id,
        event_id: from,
      });
    } catch (error) {
      this.moveDivider(previous);
      this.release(task.id);
      throw error;
    }
  }

  /** Marks an unread task read, and any other task unread. */
  toggle(task: Task) {
    return task.unread ? this.markRead(task) : this.markUnread(task);
  }

  /** Marks everything so far in these tasks read. */
  async markAllRead(tasks: Task[]) {
    const unread = tasks.filter((task) => task.unread);
    const ids = unread.map((task) => task.id);
    if (!ids.length || this.context.closed()) return;
    if (this.held && ids.includes(this.held)) this.held = undefined;
    const previous = this.clearDivider(ids);
    this.show(new Map(ids.map((id) => [id, {}])));

    try {
      await this.context.tool("app_mark_tasks_read", { task_ids: ids });
    } catch (error) {
      this.moveDivider(previous);
      this.show(new Map(unread.map((task) => [task.id, fieldsOf(task)])));
      throw error;
    }
  }

  private mark(task: Task, read: boolean) {
    return this.record(
      task,
      read ? {} : { unread: true },
      "app_set_task_read",
      { task_id: task.id, read },
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

    this.show(new Map([[task.id, shown]]));

    try {
      const result = await this.context.tool<ReadState>(name, args);

      this.show(new Map([[task.id, fieldsFrom(result)]]));
    } catch (error) {
      this.show(new Map([[task.id, fieldsOf(task)]]));
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

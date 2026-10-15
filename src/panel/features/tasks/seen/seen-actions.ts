import type { SeenState } from "../../../../shared/tasks/conversation/seen.js";
import type { Snapshot, Task } from "../../../app/state/types";

interface SeenContext {
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  report(error: unknown): void;
}

/** A task's seen fields as the list shows them; empty once it's seen. */
type SeenFields = Pick<Task, "unseen" | "seen_through">;

const fieldsFrom = (state: SeenState): SeenFields =>
  state.unseen ? { unseen: true, seen_through: state.through } : {};

const fieldsOf = (task: Task): SeenFields =>
  task.unseen ? { unseen: true, seen_through: task.seen_through } : {};

/**
 * Records what the user has seen of their tasks. Reading a task's Chat to
 * its end sees it; the user can also mark tasks seen or unseen. These run
 * beside other actions without making the panel busy, and the next refresh
 * corrects anything a failure leaves behind.
 */
export class SeenActions {
  /**
   * A task the user marked unseen while it was open. Reading it doesn't see
   * it again until they scroll its Chat to or from the end, or open another
   * task.
   */
  private held?: string;
  /** The open task while its Chat is on screen at the latest message. */
  private watched?: string;
  /** The Chat cursor each task was last seen through, so repeated renders send it once. */
  private sent = new Map<string, number>();
  /**
   * What the service has seen of a watched task that `settle` shows as seen,
   * until Chat reads past it and `read` records that.
   */
  private settled = new Map<string, number>();

  constructor(private context: SeenContext) {}

  /**
   * Records the user reading a task's Chat through event `through`, its
   * cursor. A failure stays quiet: reading happens in the background, and
   * the next render after a refresh tries again.
   */
  async read(task: Task, through: number) {
    const settled = this.settled.get(task.id);

    if (
      !(task.unseen || (settled !== undefined && settled < through)) ||
      this.held === task.id ||
      this.sent.get(task.id) === through ||
      this.context.closed()
    ) {
      return;
    }

    this.sent.set(task.id, through);
    this.settled.delete(task.id);

    try {
      const result = await this.context.tool<SeenState>(
        "mark_user_agent_task_seen",
        { task_id: task.id, seen: true, through },
      );

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
   * Keeps the watched task seen in a task-list read, so new messages don't
   * flash it unseen before Chat reads them and `read` records them.
   */
  settle(tasks: Task[]): Task[] {
    const id = this.watched;
    const task = id && tasks.find((item) => item.id === id && item.unseen);
    if (!task || this.held === id) return tasks;

    this.settled.set(id, task.seen_through ?? 0);

    return tasks.map((item) => {
      if (item !== task) return item;
      const { unseen: _unseen, seen_through: _through, ...rest } = item;

      return rest;
    });
  }

  /** Ends a hold once the user moves through the held task's Chat or opens another task. */
  release(taskId: string) {
    if (this.held === taskId) this.held = undefined;
  }

  markSeen(task: Task) {
    if (this.held === task.id) this.held = undefined;

    return this.mark(task, true);
  }

  /** Marks a task unseen; while it stays open and unscrolled, reading it doesn't see it again. */
  markUnseen(task: Task) {
    if (task.id === this.context.snapshot().selected) this.held = task.id;

    return this.mark(task, false);
  }

  /** Marks an unseen task seen, and any other task unseen. */
  toggle(task: Task) {
    return task.unseen ? this.markSeen(task) : this.markUnseen(task);
  }

  /** Sees everything so far in these tasks. */
  async markAllSeen(tasks: Task[]) {
    const unseen = tasks.filter((task) => task.unseen);
    const ids = unseen.map((task) => task.id);
    if (!ids.length || this.context.closed()) return;
    if (this.held && ids.includes(this.held)) this.held = undefined;
    this.show(new Map(ids.map((id) => [id, {}])));

    try {
      await this.context.tool("mark_user_agent_tasks_seen", { task_ids: ids });
    } catch (error) {
      this.show(new Map(unseen.map((task) => [task.id, fieldsOf(task)])));
      throw error;
    }
  }

  /**
   * Shows the change at once, then what the service recorded. Until it
   * answers, a task marked unseen has no marker, so it opens without a
   * "New" divider; the service's answer adds the marker.
   */
  private async mark(task: Task, seen: boolean) {
    if (this.context.closed()) return;
    this.sent.delete(task.id);
    this.settled.delete(task.id);

    this.show(new Map([[task.id, seen ? {} : { unseen: true }]]));

    try {
      const result = await this.context.tool<SeenState>(
        "mark_user_agent_task_seen",
        { task_id: task.id, seen },
      );

      this.show(new Map([[task.id, fieldsFrom(result)]]));
    } catch (error) {
      this.show(new Map([[task.id, fieldsOf(task)]]));
      throw error;
    }
  }

  /** Replaces the listed tasks' seen fields. */
  private show(fields: Map<string, SeenFields>) {
    if (this.context.closed()) return;
    const { tasks } = this.context.snapshot();

    if (!tasks.some((task) => fields.has(task.id))) return;

    this.context.patch({
      tasks: tasks.map((task) => {
        const next = fields.get(task.id);
        if (!next) return task;
        const { unseen: _unseen, seen_through: _through, ...rest } = task;

        return { ...rest, ...next };
      }),
    });
  }
}

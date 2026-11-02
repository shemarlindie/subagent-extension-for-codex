import { SendRejectedError } from "../../../../shared/tasks/conversation/send-errors";
import type { BudgetRaise, Delivery } from "../../../../shared/tasks/model";
import {
  isTimedPanelOperation,
  panelTimingCorrelation,
} from "../../../../shared/tasks/panel-timing";
import type { Snapshot, Task } from "../../../app/state/types";
import {
  quote,
  taskView,
  type UndoEntry,
  type UndoRecorder,
} from "../../../app/state/undo-history";
import { errorMessage } from "../../../shared/utils/error-message";
import { ArchiveActions } from "../archive/archive-actions";
import { UnreadActions } from "../unread/unread-actions";
import { boundedRequest } from "./bounded-request";
import type { TimingReporter } from "./timing-reporter";

interface TaskActionContext {
  timing: Pick<TimingReporter, "record">;
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  refresh(): Promise<void>;
  report(error: unknown): void;
  /** Drops the remembered draft of an answered question. */
  forgetQuestion(requestId: string): void;
  /** Closes the open task and returns to the task list. */
  leaveSelection(): void;
  /** Opens a task, as choosing it in the list does. */
  select(id: string): Promise<void>;
  /** Remembers changes the user can undo. */
  undo: UndoRecorder;
}

type PendingMessageRequest = {
  request_id: string;
  delivery: Delivery;
};

const UNCONFIRMED_SEND =
  "Delivery could not be confirmed. Your draft is kept. Retry the same message to safely check or complete delivery.";

/** An undo entry whose steps resolve with a failure message, as actions do. */
type ActionUndo = Omit<UndoEntry, "undo" | "redo"> & {
  undo: () => Promise<string | undefined>;
  redo: () => Promise<string | undefined>;
};

type RunOptions = {
  /** Resolve once the tool answers, refreshing in the background. */
  background?: boolean;
  /** Stop waiting after the bound and report this instead. */
  timeoutMessage?: string;
  /** Describes a failure for the user. Defaults to the error's message. */
  failureMessage?: (error: unknown) => string;
  /** Observes the tool call itself, which can settle after the bound. */
  track?: (call: Promise<unknown>) => void;
};

/**
 * Runs the task actions the Chat and inspector take outside any dialog. Each
 * resolves with the failure message, or nothing once it's done. Message sends
 * refresh in the background so acknowledgement never waits on panel reads.
 */
export class TaskActions {
  /** Records what the user has read, without making the panel busy. */
  readonly unread: UnreadActions;
  /** Archives and unarchives tasks, without making the panel busy. */
  readonly archive: ArchiveActions;
  private readonly sendRequests = new Map<string, PendingMessageRequest>();

  constructor(private context: TaskActionContext) {
    this.unread = new UnreadActions(context);
    this.archive = new ArchiveActions(context);
  }

  /** Answers a worker's pending question from the task inspector. */
  async answer(
    task: Task,
    answers: Record<string, string>,
  ): Promise<string | undefined> {
    const request = task.pending_input;

    if (!request || this.context.snapshot().busy || this.context.closed()) {
      return;
    }

    this.context.patch({ busy: true });

    try {
      await this.context.tool("submit_input", {
        task_id: task.id,
        request_id: request.id,
        approved: true,
        input: { ...request.input, answers },
      });
    } catch (error) {
      return errorMessage(error);
    } finally {
      this.context.patch({ busy: false });
    }

    // The request is answered, so nothing about it needs remembering.
    this.context.forgetQuestion(request.id);
    await this.context.refresh().catch((error) => this.context.report(error));

    return undefined;
  }

  /** Resolves a permission request directly from the task's Chat card. */
  decidePermission(task: Task, approved: boolean, message = "") {
    const request = task.pending_input;

    if (!request || request.kind !== "permission") {
      return Promise.resolve("The permission request is no longer available.");
    }

    return this.run("submit_input", {
      task_id: task.id,
      request_id: request.id,
      approved,
      message,
    });
  }

  /** Applies a new task budget without starting the next turn. */
  applyBudget(task: Task, budget: BudgetRaise) {
    return this.run("app_raise_budget", { task_id: task.id, budget });
  }

  /**
   * Sends the user's message to a task, as steer, queue or interrupt.
   * `delivered` runs once the service acknowledges it: before this resolves,
   * or later when the acknowledgement arrives after the timeout.
   */
  async sendMessage(
    task: Task,
    message: string,
    delivery: Delivery,
    delivered?: () => void,
  ) {
    // Refuse before reserving a request, so a refused send can't pin delivery.
    if (this.context.snapshot().busy || this.context.closed()) {
      return "Wait for the last action.";
    }

    const key = JSON.stringify([task.id, message]);

    // getRandomValues also works in the supported HTTP LAN console.
    // Preserve delivery when a task's status changes before an uncertain retry.
    const request = this.sendRequests.get(key) ?? {
      request_id: Array.from(
        crypto.getRandomValues(new Uint32Array(4)),
        (part) => part.toString(16).padStart(8, "0"),
      ).join(""),
      delivery,
    };

    this.sendRequests.set(key, request);

    // The call's outcome, not the bounded wait, ends the retry identity. A
    // newer request for the same text keeps its own identity.
    const release = () => {
      if (this.sendRequests.get(key) !== request) return false;
      this.sendRequests.delete(key);

      return true;
    };

    return this.run(
      "app_send_message",
      { task_id: task.id, message, ...request },
      {
        background: true,
        timeoutMessage: UNCONFIRMED_SEND,
        // Only a rejection confirms that nothing was accepted. Any other
        // failure, such as a lost response, may follow acceptance.
        failureMessage: (error) => {
          const message = errorMessage(error);

          return error instanceof SendRejectedError ||
            message === UNCONFIRMED_SEND
            ? message
            : `${message.replace(/\.$/, "")}. ${UNCONFIRMED_SEND}`;
        },
        track: (call) => {
          void call.then(
            () => {
              if (release()) delivered?.();
            },
            (error: unknown) => {
              if (error instanceof SendRejectedError) release();
            },
          );
        },
      },
    );
  }

  /** Stops a task's turn; `sendPending` sends its pending steers at once. */
  interruptTask(task: Task, sendPending = false) {
    return this.run(
      "interrupt_task",
      { task_id: task.id, send_pending: sendPending },
      {
        timeoutMessage:
          "The current turn is still stopping. Check its status before trying again.",
      },
    );
  }

  steerQueued(task: Task, messageId: string) {
    return this.run("app_steer_queued_message", {
      task_id: task.id,
      message_id: messageId,
    });
  }

  editQueued(task: Task, messageId: string, message: string) {
    const previous = task.queue.find((m) => m.id === messageId)?.message;

    const edit = (text: string) =>
      this.run("app_edit_queued_message", {
        task_id: task.id,
        message_id: messageId,
        message: text,
      });

    return this.recordUndo(
      () => edit(message),
      previous !== undefined && {
        label: `Edited ${quote(previous)}`,
        view: taskView(task.id, "chat", task.title),
        undo: () => edit(previous),
        redo: () => edit(message),
      },
    );
  }

  moveQueued(task: Task, messageId: string, index: number) {
    const from = task.queue.findIndex((m) => m.id === messageId);

    const move = (to: number) =>
      this.run("app_move_queued_message", {
        task_id: task.id,
        message_id: messageId,
        index: to,
      });

    return this.recordUndo(
      () => move(index),
      from >= 0 && {
        label: `Moved ${quote(task.queue[from]?.message ?? "")}`,
        view: taskView(task.id, "chat", task.title),
        undo: () => move(from),
        redo: () => move(index),
      },
    );
  }

  removeQueued(task: Task, messageId: string) {
    const text = task.queue.find((m) => m.id === messageId)?.message ?? "";

    return this.removeFromQueue(
      task,
      [messageId],
      `Removed ${quote(text)} from the queue`,
    );
  }

  resumeQueue(task: Task) {
    return this.run("app_resume_queue", { task_id: task.id });
  }

  clearQueue(task: Task) {
    const count = task.queue.length;

    return this.removeFromQueue(
      task,
      task.queue.map((m) => m.id),
      count === 1
        ? "Cleared 1 queued message"
        : `Cleared ${count} queued messages`,
    );
  }

  /** Renames a task, throwing when the service refuses. */
  async rename(task: Task, title: string) {
    const previous = task.title;

    const rename = async (to: string) => {
      await this.context.tool("app_rename_task", {
        task_id: task.id,
        title: to,
      });

      await this.context.refresh();
    };

    const renaming = rename(title);

    if (previous !== title) {
      this.context.undo.track(renaming, {
        // Naming both titles identifies the task wherever the user is.
        label: `Renamed ${quote(previous)} to ${quote(title)}`,
        undo: () => rename(previous),
        redo: () => rename(title),
      });
    }

    await renaming;
  }

  /**
   * Removes queued messages, which undo puts back at their places. Clearing
   * the whole queue names each message, so redo leaves later ones queued.
   */
  private removeFromQueue(task: Task, ids: string[], label: string) {
    const placements = ids.map((id) => ({
      message_id: id,
      index: task.queue.findIndex((m) => m.id === id),
    }));

    const remove = () =>
      ids.length === 1
        ? this.run("app_remove_queued_message", {
            task_id: task.id,
            message_id: ids[0],
          })
        : this.run("app_clear_queue", {
            task_id: task.id,
            ...(ids.length ? { message_ids: ids } : {}),
          });

    return this.recordUndo(
      remove,
      ids.length > 0 && {
        label,
        // The messages leave the queue, so the change shows a toast.
        toast: true,
        // The label quotes one message, and the toast lists more.
        ...(ids.length > 1
          ? {
              items: ids.map(
                (id) => task.queue.find((m) => m.id === id)?.message ?? "",
              ),
            }
          : {}),
        view: taskView(task.id, "chat", task.title),
        undo: () =>
          this.run("app_restore_queued_messages", {
            task_id: task.id,
            messages: placements,
          }),
        redo: remove,
      },
    );
  }

  /**
   * Starts an action and remembers `steps` while it saves, resolving with the
   * action's failure message. An action the panel refuses records nothing.
   */
  private recordUndo(
    start: () => Promise<string | undefined>,
    steps: ActionUndo | false,
  ) {
    if (!steps || this.context.snapshot().busy || this.context.closed()) {
      return start();
    }

    const action = start();

    this.context.undo.track(
      action,
      {
        ...steps,
        undo: () => succeed(steps.undo()),
        redo: () => succeed(steps.redo()),
      },
      (error) => !error,
    );

    return action;
  }

  /** Calls one task tool while marking the panel busy, then reloads. */
  private async run(
    name: string,
    args: Record<string, unknown>,
    {
      background = false,
      timeoutMessage,
      failureMessage = errorMessage,
      track,
    }: RunOptions = {},
  ): Promise<string | undefined> {
    if (this.context.snapshot().busy || this.context.closed()) {
      return "Wait for the last action.";
    }

    this.context.patch({ busy: true });

    try {
      const call = this.context.tool(name, args);
      // Tracking first lets it observe a prompt outcome before this resolves.
      track?.(call);

      await (timeoutMessage
        ? boundedRequest(
            () => call,
            timeoutMessage,
            (durationMs, settled) => {
              if (!isTimedPanelOperation(name)) return;

              this.context.timing.record({
                operation: name,
                duration_ms: durationMs,
                ...panelTimingCorrelation(args),
                ...settled,
              });
            },
          )
        : call);
    } catch (error) {
      return failureMessage(error);
    } finally {
      this.context.patch({ busy: false });
    }

    const refresh = this.context
      .refresh()
      .catch((error) => this.context.report(error));

    if (!background) await refresh;

    return undefined;
  }
}

/** Rejects with an action's failure message. */
async function succeed(result: Promise<string | undefined>) {
  const error = await result;
  if (error) throw new Error(error);
}

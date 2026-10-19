import { SendRejectedError } from "../../../../shared/tasks/conversation/send-errors";
import type { BudgetRaise, Delivery } from "../../../../shared/tasks/model";
import {
  isTimedPanelOperation,
  panelTimingCorrelation,
} from "../../../../shared/tasks/panel-timing";
import type { Snapshot, Task } from "../../../app/state/types";
import { errorMessage } from "../../../shared/utils/error-message";
import { ArchiveActions } from "../archive/archive-actions";
import { UnreadActions } from "../unread/unread-actions";
import { boundedRequest } from "./bounded-request";
import { TimingReporter } from "./timing-reporter";

interface TaskActionContext {
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
}

type PendingMessageRequest = {
  request_id: string;
  delivery: Delivery;
};

type RunOptions = {
  /** Resolve once the tool answers, refreshing in the background. */
  background?: boolean;
  /** Stop waiting after the bound and report this instead. */
  timeoutMessage?: string;
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
  /** Sends bounded calls' durations to the service timing log. */
  private readonly timing: TimingReporter;

  constructor(private context: TaskActionContext) {
    this.unread = new UnreadActions(context);
    this.archive = new ArchiveActions(context);
    this.timing = new TimingReporter(context);
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
        timeoutMessage:
          "Delivery could not be confirmed. Your draft is kept. Retry the same message to safely check or complete delivery.",
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
    return this.run("app_edit_queued_message", {
      task_id: task.id,
      message_id: messageId,
      message,
    });
  }

  moveQueued(task: Task, messageId: string, index: number) {
    return this.run("app_move_queued_message", {
      task_id: task.id,
      message_id: messageId,
      index,
    });
  }

  removeQueued(task: Task, messageId: string) {
    return this.run("app_remove_queued_message", {
      task_id: task.id,
      message_id: messageId,
    });
  }

  resumeQueue(task: Task) {
    return this.run("app_resume_queue", { task_id: task.id });
  }

  clearQueue(task: Task) {
    return this.run("app_clear_queue", { task_id: task.id });
  }

  /** Calls one task tool while marking the panel busy, then reloads. */
  private async run(
    name: string,
    args: Record<string, unknown>,
    { background = false, timeoutMessage, track }: RunOptions = {},
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

              this.timing.record({
                operation: name,
                duration_ms: durationMs,
                ...panelTimingCorrelation(args),
                ...settled,
              });
            },
          )
        : call);
    } catch (error) {
      return errorMessage(error);
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

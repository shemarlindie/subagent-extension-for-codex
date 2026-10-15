import type { BudgetRaise, Delivery } from "../../../../shared/tasks/model";
import type { Snapshot, Task } from "../../../app/state/types";
import { errorMessage } from "../../../shared/utils/error-message";
import { SeenActions } from "../seen/seen-actions";

interface TaskActionContext {
  snapshot(): Snapshot;
  closed(): boolean;
  patch(patch: Partial<Snapshot>): void;
  tool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  refresh(): Promise<void>;
  report(error: unknown): void;
  /** Drops the remembered draft of an answered question. */
  forgetQuestion(requestId: string): void;
}

/**
 * Runs the task actions the Chat and inspector take outside any dialog. Each
 * resolves with the failure message, or nothing once it's done and the task
 * has reloaded.
 */
export class TaskActions {
  /** Records what the user has seen, without making the panel busy. */
  readonly seen: SeenActions;

  constructor(private context: TaskActionContext) {
    this.seen = new SeenActions(context);
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
      await this.context.tool("submit_agent_input", {
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

    return this.run("submit_agent_input", {
      task_id: task.id,
      request_id: request.id,
      approved,
      message,
    });
  }

  /** Applies a new task budget without starting the next turn. */
  applyBudget(task: Task, budget: BudgetRaise) {
    return this.run("raise_user_agent_budget", { task_id: task.id, budget });
  }

  /** Sends the user's message to a task, as steer, queue or interrupt. */
  sendMessage(task: Task, message: string, delivery: Delivery) {
    return this.run("send_user_agent_message", {
      task_id: task.id,
      message,
      delivery,
    });
  }

  /** Stops a task's turn; `sendPending` sends its pending steers at once. */
  interruptTask(task: Task, sendPending = false) {
    return this.run("interrupt_agent_task", {
      task_id: task.id,
      send_pending: sendPending,
    });
  }

  editQueued(task: Task, messageId: string, message: string) {
    return this.run("edit_user_agent_queued_message", {
      task_id: task.id,
      message_id: messageId,
      message,
    });
  }

  moveQueued(task: Task, messageId: string, index: number) {
    return this.run("move_user_agent_queued_message", {
      task_id: task.id,
      message_id: messageId,
      index,
    });
  }

  removeQueued(task: Task, messageId: string) {
    return this.run("remove_user_agent_queued_message", {
      task_id: task.id,
      message_id: messageId,
    });
  }

  resumeQueue(task: Task) {
    return this.run("resume_user_agent_queue", { task_id: task.id });
  }

  clearQueue(task: Task) {
    return this.run("clear_user_agent_queue", { task_id: task.id });
  }

  /** Calls one task tool while marking the panel busy, then reloads. */
  private async run(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string | undefined> {
    if (this.context.snapshot().busy || this.context.closed()) {
      return "Wait for the last action.";
    }

    this.context.patch({ busy: true });

    try {
      await this.context.tool(name, args);
    } catch (error) {
      return errorMessage(error);
    } finally {
      this.context.patch({ busy: false });
    }

    await this.context.refresh().catch((error) => this.context.report(error));

    return undefined;
  }
}

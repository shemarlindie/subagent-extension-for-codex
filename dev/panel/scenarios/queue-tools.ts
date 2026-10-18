import { composerMode } from "../../../src/panel/features/tasks/chat/chat-model";
import type {
  Delivery,
  Task,
  TaskMessage,
} from "../../../src/shared/tasks/model";

/** Queue tools the browser fixtures answer by changing the task in memory. */
export const PREVIEW_QUEUE_TOOLS = [
  "app_send_message",
  "app_steer_queued_message",
  "app_edit_queued_message",
  "app_move_queued_message",
  "app_remove_queued_message",
  "app_clear_queue",
];

/**
 * Applies a queue tool to a fixture task with the service's rules, so
 * queued and steered messages, reordering, edits and removals show until the
 * preview reloads. Steers stay pending, since no worker takes them. Anything
 * that would start or stop a turn (a send to an idle task, an interrupt, a
 * resume) stays preview-only.
 */
export function previewQueueTool(
  task: Task | undefined,
  name: string,
  args: Record<string, unknown>,
) {
  if (!task) throw new Error("Task not found");
  if (name === "app_send_message") return previewSend(task, args);

  if (name === "app_clear_queue") {
    task.queue = [];
    delete task.queue_paused;

    return task;
  }

  const message = task.queue.find((m) => m.id === args.message_id);
  if (!message) throw new Error("That message is no longer queued.");

  if (name === "app_steer_queued_message") {
    if (message.recorded) {
      throw new Error("That steer has already been sent to the worker.");
    }

    if (composerMode(task) !== "busy") {
      throw new Error(
        "Steer a queued message while the task is busy and accepts input.",
      );
    }

    task.queue = task.queue.filter((m) => m !== message);
    if (!task.queue.length) delete task.queue_paused;

    task.pending_steers.push({
      id: message.id,
      message: message.message,
      from: message.from,
    });
  } else if (name === "app_edit_queued_message") {
    if (message.recorded) {
      throw new Error("A steer the worker already has can't be edited.");
    }

    message.message = String(args.message);
  } else if (name === "app_move_queued_message") {
    if (message.recorded) {
      throw new Error("A steer the worker already has stays at the front.");
    }

    const rest = task.queue.filter((m) => m !== message);
    const first = rest.filter((m) => m.recorded).length;

    rest.splice(
      Math.min(Math.max(Number(args.index), first), rest.length),
      0,
      message,
    );

    task.queue = rest;
  } else {
    task.queue = task.queue.filter((m) => m !== message);
    if (!task.queue.length) delete task.queue_paused;
  }

  return task;
}

let sent = 0;

function previewSend(task: Task, args: Record<string, unknown>) {
  const delivery = (args.delivery ?? "steer") as Delivery,
    mode = composerMode(task);

  if (mode === "idle" || delivery === "interrupt") {
    throw new Error(
      "Design preview only. No worker or service action was executed.",
    );
  }

  if (mode === "input" && delivery === "steer") {
    throw new Error(
      "The worker is waiting for input, so it can't be steered. Answer its request, or queue the message.",
    );
  }

  const message: TaskMessage = {
    id: `msg_preview_sent_${++sent}`,
    message: String(args.message),
    from: "user",
  };

  if (delivery === "queue") task.queue.push({ ...message, delivery });
  else task.pending_steers.push(message);

  return {
    message_id: message.id,
    state: delivery === "queue" ? "queued" : "started",
    status: task.status,
  };
}

import { composerMode } from "../../../src/panel/features/tasks/chat/chat-model";
import type {
  Delivery,
  QueuedMessage,
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
  "app_restore_queued_messages",
];

/** Removed messages by ID, standing in for the service's recorded events. */
const removed = new Map<string, QueuedMessage>();

/** Removes queued messages, remembering them for undo. */
function removeQueued(task: Task, gone: QueuedMessage[]) {
  for (const m of gone) removed.set(m.id, { ...m });
  task.queue = task.queue.filter((m) => !gone.includes(m));
  if (!task.queue.length) delete task.queue_paused;
}

/** Puts removed messages back at their places, as the service does. */
function restoreQueued(task: Task, args: Record<string, unknown>) {
  const placements = (args.messages as { message_id: string; index: number }[])
    .filter(
      ({ message_id: id }) =>
        removed.has(id) &&
        ![...task.queue, ...task.pending_steers].some((m) => m.id === id),
    )
    .toSorted((a, b) => a.index - b.index);

  for (const { message_id: id, index } of placements) {
    const m = removed.get(id)!;
    const first = task.queue.filter((q) => q.recorded).length;

    task.queue.splice(
      m.recorded
        ? Math.min(index, first)
        : Math.min(Math.max(index, first), task.queue.length),
      0,
      m,
    );

    removed.delete(id);
  }

  // The preview never runs a turn, so an idle task's queue stays paused.
  if (placements.length && composerMode(task) === "idle") {
    task.queue_paused = true;
  }

  return task;
}

/**
 * Applies a queue tool to a fixture task with the service's rules, so
 * queued and steered messages, reordering, edits, removals and their undo
 * show until the preview reloads. Steers stay pending, since no worker takes
 * them. Anything that would start or stop a turn (a send to an idle task, an
 * interrupt, a resume) stays preview-only.
 */
export function previewQueueTool(
  task: Task | undefined,
  name: string,
  args: Record<string, unknown>,
) {
  if (!task) throw new Error("Task not found");
  if (name === "app_send_message") return previewSend(task, args);

  if (name === "app_restore_queued_messages") return restoreQueued(task, args);

  if (name === "app_clear_queue") {
    const ids = args.message_ids as string[] | undefined;

    removeQueued(
      task,
      task.queue.filter((m) => !ids || ids.includes(m.id)),
    );

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
    removeQueued(task, [message]);
  }

  return task;
}

let sent = 0;

function previewSend(task: Task, args: Record<string, unknown>) {
  const delivery = (args.delivery ?? "steer") as Delivery;
  const mode = composerMode(task);

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

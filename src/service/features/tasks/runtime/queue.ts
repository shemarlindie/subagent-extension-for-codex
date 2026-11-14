import { eventPayload } from "../../../../shared/events/payload.js";
import { checkWaitingLimit } from "../../../../shared/tasks/conversation/waiting-limit.js";
import type {
  QueuedMessage,
  Sender,
  Task,
  TaskMessage,
} from "../../../../shared/tasks/model.js";
import type { Store } from "../storage/store.js";

/** The queue as `task.queue_changed` records it. */
export function queueSnapshot(t: Task) {
  return {
    queue: t.queue.map((m) => ({
      message_id: m.id,
      message: m.message,
      from: m.from,
    })),
    paused: !!t.queue_paused,
  };
}

type QueueSnapshot = ReturnType<typeof queueSnapshot>;

/** Records the queue when it differs from `before`. Runs inside a transaction. */
export function recordQueueChange(
  store: Store,
  t: Task,
  before: QueueSnapshot,
) {
  const after = queueSnapshot(t);

  if (JSON.stringify(after) !== JSON.stringify(before)) {
    store.event(t, "task.queue_changed", after);
  }
}

/**
 * Saves a task whose queue changed since `before`, with any events `record`
 * adds, then the queue change, in one transaction.
 */
export function commitQueue(
  store: Store,
  t: Task,
  before: QueueSnapshot,
  record?: () => void,
) {
  store.transaction(() => {
    store.save(t);
    record?.();
    recordQueueChange(store, t, before);
  });
}

/** Moves the steers a turn didn't take to the front of the queue. */
export function leaveOver(t: Task) {
  t.queue.unshift(
    ...t.pending_steers.map((m): QueuedMessage => ({
      ...m,
      delivery: "steer",
      recorded: true,
    })),
  );

  t.pending_steers = [];
}

export function recordMessage(
  store: Store,
  t: Task,
  m: TaskMessage,
  delivery: QueuedMessage["delivery"],
) {
  store.event(t, "task.instruction", {
    message_id: m.id,
    message: m.message,
    from: m.from,
    delivery,
  });
}

/** Records a queued message as sent, for the turn it starts. */
export function deliverQueued(store: Store, t: Task, m: QueuedMessage) {
  if (!m.recorded) recordMessage(store, t, m, m.delivery);
  store.messages.add(t.id, { id: m.id, message: m.message, from: m.from });
}

/** Marks a task as having its next turn ready to start. */
export function requeue(t: Task) {
  t.status = "queued";
  delete t.error;
  delete t.error_code;
  delete t.completed_at;
}

function queuedMessage(t: Task, messageId: string) {
  const m = t.queue.find((m) => m.id === messageId);
  if (!m) throw new Error("That message is no longer queued.");

  return m;
}

/** Moves a queued message into the turn's input, recording it exactly once. */
export function steerQueuedMessage(
  store: Store,
  t: Task,
  messageId: string,
  active: boolean,
) {
  if (!["queued", "starting", "running", "waiting"].includes(t.status)) {
    throw new Error("Steer a queued message while the task is busy.");
  }

  if (t.pending_input) {
    throw new Error("The worker is waiting for input, so it can't be steered.");
  }

  const message = queuedMessage(t, messageId);

  if (message.recorded) {
    throw new Error("That steer has already been sent to the worker.");
  }

  const before = queueSnapshot(t);

  const m: TaskMessage = {
    id: message.id,
    message: message.message,
    from: message.from,
  };

  t.queue = t.queue.filter((item) => item.id !== messageId);
  if (!t.queue.length) delete t.queue_paused;
  if (active) t.pending_steers.push(m);

  commitQueue(store, t, before, () => {
    if (!active) store.messages.add(t.id, m);
    recordMessage(store, t, m, "steer");
  });

  return m;
}

/** Changes a queued message's text before it's sent. */
export function editQueuedMessage(
  store: Store,
  t: Task,
  messageId: string,
  message: string,
) {
  const m = queuedMessage(t, messageId);

  if (m.recorded) {
    throw new Error("A steer the worker already has can't be edited.");
  }

  const before = queueSnapshot(t);
  m.message = message;
  commitQueue(store, t, before);
}

/**
 * Moves a queued message to `index` in the queue. Steers the worker already
 * has stay at the front, so nothing moves ahead of them.
 */
export function moveQueuedMessage(
  store: Store,
  t: Task,
  messageId: string,
  index: number,
) {
  const m = queuedMessage(t, messageId);

  if (m.recorded) {
    throw new Error("A steer the worker already has stays at the front.");
  }

  const before = queueSnapshot(t);
  const rest = t.queue.filter((q) => q !== m);
  const first = rest.filter((q) => q.recorded).length;
  rest.splice(Math.min(Math.max(index, first), rest.length), 0, m);
  t.queue = rest;
  commitQueue(store, t, before);
}

/**
 * Removes a queued message before it's sent. The parent agent can remove
 * only messages it queued.
 */
export function removeQueuedMessage(
  store: Store,
  t: Task,
  messageId: string,
  by: Sender,
) {
  const m = queuedMessage(t, messageId);

  if (by === "parent" && m.from !== "parent") {
    throw new Error("The parent agent can remove only messages it queued.");
  }

  const before = queueSnapshot(t);
  t.queue = t.queue.filter((q) => q !== m);
  if (!t.queue.length) delete t.queue_paused;

  commitQueue(store, t, before, () =>
    store.event(t, "task.message_removed", { message_id: m.id }),
  );
}

/** Removes the listed queued messages, or every one without a list. */
export function clearQueuedMessages(
  store: Store,
  t: Task,
  messageIds?: readonly string[],
) {
  const before = queueSnapshot(t);

  const removed = messageIds
    ? t.queue.filter((m) => messageIds.includes(m.id))
    : t.queue;

  t.queue = t.queue.filter((m) => !removed.includes(m));
  if (!t.queue.length) delete t.queue_paused;

  commitQueue(store, t, before, () => {
    for (const m of removed) {
      store.event(t, "task.message_removed", { message_id: m.id });
    }
  });
}

/** Where a removed queued message goes back. */
export type QueuePlacement = { message_id: string; index: number };

/**
 * The listed messages the task's queue lost to removal, as they last stood.
 * The task's events supply each one's text and sender, and whether the worker
 * already has it as a steer, so the caller can't change them.
 */
function removedMessages(store: Store, t: Task, ids: Set<string>) {
  const found = new Map<string, QueuedMessage>();
  const removed = new Set<string>();
  const recorded = new Set<string>();

  const events = store.eventsOfTypes(t.id, [
    "task.queue_changed",
    "task.message_removed",
    "task.instruction",
  ]);

  for (const e of events) {
    const removal = eventPayload(e, "task.message_removed");
    const instruction = eventPayload(e, "task.instruction");
    const queue = eventPayload(e, "task.queue_changed")?.queue ?? [];

    if (removal) removed.add(removal.message_id);
    if (instruction) recorded.add(instruction.message_id);

    // A later snapshot holds the message's latest text.
    for (const m of queue) {
      if (!ids.has(m.message_id)) continue;

      found.set(m.message_id, {
        id: m.message_id,
        message: m.message,
        from: m.from,
        delivery: "queue",
      });
    }
  }

  return new Map<string, QueuedMessage>(
    [...found]
      .filter(([id]) => removed.has(id))
      .map(([id, m]) => [
        id,
        recorded.has(id)
          ? { ...m, delivery: "steer" as const, recorded: true }
          : m,
      ]),
  );
}

/**
 * Puts removed queued messages back at their places, with their identity and
 * sender. A message sent, queued or unknown since stays as it is. Restoring
 * never starts a turn: a task that isn't busy keeps its queue paused. Writes
 * `record` adds commit with the queue. Returns whether the queue changed.
 */
export function restoreQueuedMessages(
  store: Store,
  t: Task,
  placements: readonly QueuePlacement[],
  busy: boolean,
  record?: () => void,
) {
  const queued = new Set([...t.queue, ...t.pending_steers].map((m) => m.id));

  const removed = placements
    .map((p) => p.message_id)
    .filter((id) => !queued.has(id));

  const sent = store.messages.existing(t.id, removed);

  const messages = removedMessages(
    store,
    t,
    new Set(removed.filter((id) => !sent.has(id))),
  );

  const restoring = placements
    .filter((p) => messages.has(p.message_id))
    .toSorted((a, b) => a.index - b.index);

  if (!restoring.length) return false;

  checkWaitingLimit(t, restoring.length);
  const before = queueSnapshot(t);

  for (const { message_id: id, index } of restoring) {
    const m = messages.get(id)!;
    const first = t.queue.filter((q) => q.recorded).length;

    // Steers the worker already has lead the queue.
    const at = m.recorded
      ? Math.min(index, first)
      : Math.min(Math.max(index, first), t.queue.length);

    t.queue.splice(at, 0, m);
  }

  if (!busy) t.queue_paused = true;
  commitQueue(store, t, before, record);

  return true;
}

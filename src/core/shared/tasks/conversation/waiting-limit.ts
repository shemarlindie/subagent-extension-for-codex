import type { Task } from "../model.js";

/**
 * The most messages a task holds waiting, queued or steered. Moves between
 * the two keep the count, so only new messages are checked.
 */
export const WAITING_MESSAGE_LIMIT = 10;

/** Refuses `adding` more waiting messages when they would pass the limit. */
export function checkWaitingLimit(
  t: Pick<Task, "queue" | "pending_steers">,
  adding: number,
) {
  if (
    t.queue.length + t.pending_steers.length + adding >
    WAITING_MESSAGE_LIMIT
  ) {
    throw new Error(
      `A task can hold at most ${WAITING_MESSAGE_LIMIT} waiting messages. Wait for the worker to take one, or remove a queued message.`,
    );
  }
}

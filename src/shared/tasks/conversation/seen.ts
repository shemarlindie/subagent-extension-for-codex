/**
 * Events that give the user something new to see in a task: worker messages
 * and replies, a turn's end, a task failure and a question or permission
 * request. The user's own messages never make a task unseen.
 */
export const SEEN_EVENTS = [
  "agent.message",
  "agent.reply",
  "task.turn_ended",
  "task.failed",
  "agent.input_required",
];

/** What the user has seen of a task: its events through `through`, unless they marked it unseen. */
export type SeenMark = { through: number; unseen: boolean };

/** Whether a task has something unseen, and the newest event the user had seen. */
export type SeenState = { unseen: boolean; through: number };

/** Whether a task whose newest `SEEN_EVENTS` event is `latest` has something the user hasn't seen. */
export const isUnseen = (latest: number, mark?: SeenMark) =>
  Boolean(mark?.unseen) || latest > (mark?.through ?? 0);

/**
 * Events that give the user something new to read in a task: worker messages
 * and replies, a turn's end, a task failure and a question or permission
 * request. The user's own messages never make a task unread.
 */
export const READ_EVENTS = [
  "agent.message",
  "agent.reply",
  "task.turn_ended",
  "task.failed",
  "agent.input_required",
];

/** What the user has read of a task: its events through `through`, unless they marked it unread. */
export type ReadMark = { through: number; unread: boolean };

/** Whether a task has something unread, and the newest event the user had read. */
export type ReadState = { unread: boolean; through: number };

/** Whether a task whose newest `READ_EVENTS` event is `latest` has something the user hasn't read. */
export const isUnread = (latest: number, mark?: ReadMark) =>
  Boolean(mark?.unread) || latest > (mark?.through ?? 0);

import { eventPayload } from "../events/payload.js";
import type { Event } from "../events/types.js";
import { currentActivityStatus } from "./activity/activity-status.js";
import type { Draft } from "./conversation/drafts.js";
import { replyExcerpt } from "./conversation/reply.js";
import type { ReadState } from "./conversation/unread.js";
import type { Task } from "./model.js";

/** The start of a task's latest reply, so a list can be scanned without opening each task. */
export type ReplyExcerpt = { turn: number; text: string };

export type ListedTask = Task & {
  live_activity?: ReturnType<typeof currentActivityStatus>;
  reply?: ReplyExcerpt;
  queued_messages?: number;
  /** The worker's unfinished message, as a fallback to streaming it. */
  draft?: Draft;
  /** The task has a reply, outcome or request the user hasn't read. */
  unread?: true;
  /** With `unread`, the newest event the user had read; Chat marks what follows as new. */
  read_through?: number;
  /** When the user archived the task; the panel lists it only under Archived. */
  archived_at?: string;
};

/** A latest `agent.reply` event as a listed task's excerpt. */
export function replyFrom(event?: Event): ReplyExcerpt | undefined {
  if (!event) return undefined;
  const reply = eventPayload(event, "agent.reply");
  if (!reply) return undefined;

  return {
    turn: reply.turn ?? 0,
    text: replyExcerpt(reply.text),
  };
}

/** A task's read fields: present only while the user has something unread in it. */
export function readFields(read?: ReadState) {
  return read?.unread
    ? { unread: true as const, read_through: read.through }
    : {};
}

/** Activity summaries are derived for the list, never persisted as task state. */
export function listedTask(
  task: Task,
  events: Event[],
  reply?: Event,
  draft?: Draft,
  read?: ReadState,
  archivedAt?: string,
): ListedTask {
  const excerpt = replyFrom(reply);

  return {
    ...task,
    ...(task.status === "running"
      ? { live_activity: currentActivityStatus(events, task) }
      : {}),
    ...(excerpt ? { reply: excerpt } : {}),
    ...(draft ? { draft } : {}),
    ...readFields(read),
    ...(archivedAt ? { archived_at: archivedAt } : {}),
    queued_messages: task.queue.length,
  };
}

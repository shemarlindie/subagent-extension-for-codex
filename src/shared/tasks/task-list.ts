import { eventPayload } from "../events/payload.js";
import type { Event } from "../events/types.js";
import { currentActivityStatus } from "./activity/activity-status.js";
import type { Draft } from "./conversation/drafts.js";
import { replyExcerpt } from "./conversation/reply.js";
import type { SeenState } from "./conversation/seen.js";
import type { Task } from "./model.js";

/** The start of a task's latest reply, so a list can be scanned without opening each task. */
export type ReplyExcerpt = { turn: number; text: string };

export type ListedTask = Task & {
  live_activity?: ReturnType<typeof currentActivityStatus>;
  reply?: ReplyExcerpt;
  queued_messages?: number;
  /** The worker's unfinished message, as a fallback to streaming it. */
  draft?: Draft;
  /** The task has a reply, outcome or request the user hasn't seen. */
  unseen?: true;
  /** With `unseen`, the newest event the user had seen; Chat marks what follows as new. */
  seen_through?: number;
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

/** Activity summaries are derived for the list, never persisted as task state. */
export function listedTask(
  task: Task,
  events: Event[],
  reply?: Event,
  draft?: Draft,
  seen?: SeenState,
): ListedTask {
  const excerpt = replyFrom(reply);

  return {
    ...task,
    ...(task.status === "running"
      ? { live_activity: currentActivityStatus(events, task) }
      : {}),
    ...(excerpt ? { reply: excerpt } : {}),
    ...(draft ? { draft } : {}),
    ...(seen?.unseen
      ? { unseen: true as const, seen_through: seen.through }
      : {}),
    queued_messages: task.queue.length,
  };
}

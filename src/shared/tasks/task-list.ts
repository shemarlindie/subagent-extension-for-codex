import { eventPayload } from "../events/payload.js";
import type { Event } from "../events/types.js";
import { currentActivityStatus } from "./activity/activity-timeline.js";
import type { Draft } from "./conversation/drafts.js";
import { replyExcerpt } from "./conversation/reply.js";
import type { Task } from "./model.js";

/** The start of a task's latest reply, so a list can be scanned without opening each task. */
export type ReplyExcerpt = { turn: number; text: string };

export type ListedTask = Task & {
  live_activity?: ReturnType<typeof currentActivityStatus>;
  reply?: ReplyExcerpt;
  queued_messages?: number;
  /** The worker's unfinished message, as a fallback to streaming it. */
  draft?: Draft;
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
): ListedTask {
  const excerpt = replyFrom(reply);

  return {
    ...task,
    ...(task.status === "running"
      ? { live_activity: currentActivityStatus(events, task) }
      : {}),
    ...(excerpt ? { reply: excerpt } : {}),
    ...(draft ? { draft } : {}),
    queued_messages: task.queue.length,
  };
}

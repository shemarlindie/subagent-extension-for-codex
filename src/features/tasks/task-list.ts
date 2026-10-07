import type { Event, Task } from "../../shared/contracts.js";
import { currentActivityStatus } from "./activity/activity-timeline.js";
import type { Draft } from "./drafts.js";
import { replyExcerpt } from "./reply.js";

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
  return event
    ? {
        turn: Number(event.data.turn),
        text: replyExcerpt(String(event.data.text ?? "")),
      }
    : undefined;
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

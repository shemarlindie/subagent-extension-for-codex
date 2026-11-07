import { eventPayload } from "../events/payload.js";
import type { Event } from "../events/types.js";
import { currentActivityStatus } from "./activity/activity-status.js";
import type { Draft } from "./conversation/drafts.js";
import { replyExcerpt } from "./conversation/reply.js";
import type { ReadState } from "./conversation/unread.js";
import type { Task, TaskView } from "./model.js";

/** The start of a task's latest reply, so a list can be scanned without opening each task. */
export type ReplyExcerpt = { turn: number; text: string };

/** What a parent agent needs to find a task and decide whether to read it. */
export type TaskSummary = Pick<
  Task,
  | "id"
  | "title"
  | "status"
  | "repository"
  | "conversation_id"
  | "worker_profile"
  | "turn"
  | "error"
  | "error_code"
> & {
  /** The kind of request waiting for an answer. */
  pending_input?: "question" | "permission";
  reply?: ReplyExcerpt;
  queued_messages: number;
  archived_at?: string;
};

/** A task as the panel lists it. Chat reads the conversation through its own tool. */
export type PanelTask = TaskView & {
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
    turn: reply.turn,
    text: replyExcerpt(reply.text),
  };
}

/** A task's read fields: present only while the user has something unread in it. */
export function readFields(read?: ReadState) {
  return read?.unread
    ? { unread: true as const, read_through: read.through }
    : {};
}

/** A task as `list_tasks` returns it to a parent agent. */
export function taskSummary(
  task: Task,
  reply?: Event,
  archivedAt?: string,
): TaskSummary {
  const excerpt = replyFrom(reply);

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    repository: task.repository,
    ...(task.conversation_id ? { conversation_id: task.conversation_id } : {}),
    worker_profile: task.worker_profile,
    turn: task.turn,
    ...(task.error ? { error: task.error } : {}),
    ...(task.error_code ? { error_code: task.error_code } : {}),
    ...(task.pending_input ? { pending_input: task.pending_input.kind } : {}),
    ...(excerpt ? { reply: excerpt } : {}),
    queued_messages: task.queue.length,
    ...(archivedAt ? { archived_at: archivedAt } : {}),
  };
}

/**
 * Fields the panel's list leaves out. Undefined fields drop out of the sent
 * result, which costs less than copying each task without them.
 */
const unsent = { instructions: undefined, context: undefined };

/** Activity summaries are derived for the list, never persisted as task state. */
export function panelTask(
  task: Task,
  events: Event[],
  reply?: Event,
  draft?: Draft,
  read?: ReadState,
  archivedAt?: string,
): PanelTask {
  const excerpt = replyFrom(reply);

  return {
    ...task,
    ...unsent,
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

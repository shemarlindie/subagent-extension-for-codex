import { eventPayload } from "../../events/payload.js";
import type { Event } from "../../events/types.js";
import { failureMessage, isBudgetFailure } from "../failure.js";
import type { Task } from "../model.js";
import { replyExcerpt } from "./reply.js";

/** Events that can give the parent agent a worker update to see. */
export const PARENT_UPDATE_EVENTS = [
  "agent.reply",
  "task.failed",
  "agent.input_required",
];

/** The longest update snippet. The panel shows one line of it. */
const SNIPPET_CHARS = 200;

/** A worker update the parent agent hasn't seen. */
export type ParentUpdate = {
  event_id: number;
  kind: "reply" | "failed" | "budget" | "request";
  text: string;
  timestamp: string;
};

/** A task's pending updates, newest first. */
export type PendingTaskUpdates = {
  task_id: string;
  title: string;
  updates: ParentUpdate[];
};

/** The first question of a request, or its permission description. */
function requestText(input: NonNullable<Task["pending_input"]>) {
  const questions = input.input.questions;
  const first: unknown = Array.isArray(questions) ? questions[0] : undefined;

  if (first && typeof first === "object" && "question" in first) {
    return String(first.question);
  }

  return input.presentation?.description ?? input.tool;
}

/**
 * The update an event gives the parent agent, if any: a turn's reply, a
 * failure, or the task's current request when the parent may answer it.
 * `parentDecides` says whether the parent may decide its permissions.
 */
export function parentUpdate(
  task: Task,
  e: Event,
  parentDecides: boolean,
): ParentUpdate | undefined {
  const base = { event_id: e.id, timestamp: e.timestamp };
  const reply = eventPayload(e, "agent.reply");

  if (reply) {
    return {
      ...base,
      kind: "reply",
      text: replyExcerpt(reply.text, SNIPPET_CHARS),
    };
  }

  const failed = eventPayload(e, "task.failed");

  if (failed) {
    return {
      ...base,
      kind: isBudgetFailure(failed.error_code) ? "budget" : "failed",
      text: replyExcerpt(
        failureMessage(failed) ?? "The task failed.",
        SNIPPET_CHARS,
      ),
    };
  }

  const request = eventPayload(e, "agent.input_required")?.request;
  const pending = task.pending_input;

  if (
    request &&
    pending?.id === request.id &&
    (pending.kind === "question" || parentDecides)
  ) {
    return {
      ...base,
      kind: "request",
      text: replyExcerpt(requestText(pending), SNIPPET_CHARS),
    };
  }

  return undefined;
}

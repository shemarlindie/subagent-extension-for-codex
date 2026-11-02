import type { EventEnvelope } from "../../events/event-contract.js";
import type { ClaudeRawResponse } from "./events.js";

/** Fields consumed by normalized Activity, Chat and completion accounting. */
const activityFields = new Set([
  "type",
  "subtype",
  "uuid",
  "parent_tool_use_id",
  "attempt",
  "compact_error",
  "compact_result",
  "content",
  "description",
  "error",
  "errors",
  "hook_id",
  "hook_name",
  "isAuthenticating",
  "is_error",
  "message",
  "message_id",
  "outcome",
  "output",
  "patch",
  "rate_limit_info",
  "result",
  "state",
  "status",
  "stderr",
  "summary",
  "task_id",
  "text",
  "tool_use_id",
  "tool_name",
  "elapsed_time_seconds",
  "event",
  "duration_ms",
  "total_cost_usd",
  "cost_usd",
  "usage",
  // Recording also uses this projection on an already normalized event.
  "activity",
  "response_ref",
  "raw_response",
]);

export function normalizedClaudeFields(
  message: object,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(message).filter(
      ([key, value]) =>
        activityFields.has(key) &&
        !(key === "message" && typeof value === "object"),
    ),
  );
}

/** A task-scoped lookup shared by recording, replay and diagnostic verification. */
export function originalResponseLookup(events: readonly EventEnvelope[]) {
  const responses = new Map<string, ClaudeRawResponse>();

  for (const event of events) {
    if (
      typeof event.data.response_ref === "string" &&
      event.data.raw_response
    ) {
      responses.set(
        `${event.task_id}/${event.data.response_ref}`,
        event.data.raw_response as ClaudeRawResponse,
      );
    }
  }

  return (
    event: Pick<EventEnvelope, "task_id" | "data">,
  ): ClaudeRawResponse | undefined =>
    (event.data.raw_response as ClaudeRawResponse | undefined) ??
    (typeof event.data.response_ref === "string"
      ? responses.get(`${event.task_id}/${event.data.response_ref}`)
      : undefined);
}

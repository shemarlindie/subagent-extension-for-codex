import { and, eq } from "drizzle-orm";

import { decodedEvent } from "../../../../shared/events/decode.js";
import { isChatEvent } from "../../../../shared/tasks/conversation/chat.js";
import { now } from "../../../../shared/time.js";
import type { Database } from "../../../platform/database/database.js";
import type { EventStorageMetrics } from "./event-storage-metrics.js";
import { events } from "./schema.js";

export const eventColumns = {
  id: events.id,
  task_id: events.task_id,
  type: events.type,
  timestamp: events.timestamp,
  data: events.data,
};

/** Internal lookup. The caller must authorize the task before reading. */
export function readOriginalResponse(
  database: Database,
  id: string,
  responseRef: string,
): unknown {
  const row = database.orm
    .select({ body: events.original_response })
    .from(events)
    .where(and(eq(events.response_ref, responseRef), eq(events.task_id, id)))
    .get();

  return row?.body ? JSON.parse(row.body) : undefined;
}

/**
 * Serialize the original once and keep it outside ordinary event projections.
 * Only an owning event with a `response_ref` stores one.
 */
function splitOriginalResponse(payload: Record<string, unknown>) {
  const response =
    typeof payload.response_ref === "string" &&
    payload.raw_response !== undefined
      ? {
          id: payload.response_ref,
          body: JSON.stringify(payload.raw_response),
        }
      : undefined;

  const { raw_response: _original, ...data } = payload;

  return { data, response, serialized: JSON.stringify(data) };
}

export function insertEvent(
  database: Database,
  metrics: EventStorageMetrics,
  taskId: string,
  type: string,
  payload: Record<string, unknown>,
) {
  const timestamp = now();
  const stored = splitOriginalResponse(payload);

  const { id } = database.orm
    .insert(events)
    .values({
      task_id: taskId,
      type,
      timestamp,
      data: stored.serialized,
      response_ref: stored.response?.id,
      original_response: stored.response?.body,
      chat: isChatEvent(type, stored.data),
    })
    .returning({ id: events.id })
    .get();

  metrics.committed(database, taskId, stored.serialized, stored.response?.body);

  return decodedEvent({
    id,
    task_id: taskId,
    type,
    timestamp,
    data: stored.data,
  });
}

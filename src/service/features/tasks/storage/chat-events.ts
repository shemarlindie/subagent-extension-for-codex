import { and, eq } from "drizzle-orm";

import type { Database } from "../../../platform/database/database.js";
import { eventColumns } from "./event-records.js";
import { events } from "./schema.js";
import { decodeEvent } from "./stored.js";

/** The events Chat shows, in order, or only those of `types`. */
export function chatEvents(
  orm: Database["orm"],
  id: string,
  types?: readonly string[],
) {
  return orm
    .select(eventColumns)
    .from(events)
    .where(and(eq(events.task_id, id), eq(events.chat, true)))
    .orderBy(events.id)
    .all()
    .filter((row) => !types || types.includes(row.type))
    .map(decodeEvent);
}

import { and, eq, inArray, or, sql } from "drizzle-orm";

import type { Database } from "../../../platform/database/database.js";
import { eventColumns } from "./event-records.js";
import { events } from "./schema.js";
import { decodeEvent } from "./stored.js";

/** Chat's durable inputs, including compaction records among provider activity. */
export function chatEvents(orm: Database["orm"], id: string, types: string[]) {
  const compaction = and(
    eq(events.type, "claude.activity"),
    // A plain text match first, so most activity skips parsing its JSON.
    sql`instr(${events.data}, 'compact') > 0`,
    sql`(json_extract(${events.data},'$.subtype')='compact_boundary' OR json_extract(${events.data},'$.compact_result')='failed')`,
  );

  return orm
    .select(eventColumns)
    .from(events)
    .where(
      and(eq(events.task_id, id), or(inArray(events.type, types), compaction)),
    )
    .orderBy(events.id)
    .all()
    .map(decodeEvent);
}

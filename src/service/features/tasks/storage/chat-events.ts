import { and, eq, max } from "drizzle-orm";

import type { Database } from "../../../platform/database/database.js";
import { eventColumns } from "./event-records.js";
import { events } from "./schema.js";
import { decodeEvent } from "./stored.js";

/**
 * The events Chat shows, in order, or only those of `types`. Every Chat item
 * takes its event from them, so returning none when none is newer than
 * `after` gives a read from that cursor what all of them would, and spares
 * the caller rebuilding Chat.
 */
export function chatEvents(
  orm: Database["orm"],
  id: string,
  after = 0,
  types?: readonly string[],
) {
  const chat = and(eq(events.task_id, id), eq(events.chat, true));

  if (after > 0) {
    const newest = orm
      .select({ id: max(events.id) })
      .from(events)
      .where(chat)
      .get();

    if ((newest?.id ?? 0) <= after) return [];
  }

  return orm
    .select(eventColumns)
    .from(events)
    .where(chat)
    .orderBy(events.id)
    .all()
    .filter((row) => !types || types.includes(row.type))
    .map(decodeEvent);
}

import { and, eq, inArray, max, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import type { Event } from "../../../../shared/events/types.js";
import {
  isUnread,
  READ_EVENTS,
  type ReadState,
} from "../../../../shared/tasks/conversation/unread.js";
import type { Task } from "../../../../shared/tasks/model.js";
import type { Database } from "../../../platform/database/database.js";
import { eventColumns } from "./event-records.js";
import { events, taskArchive, taskRead, tasks } from "./schema.js";
import { decodeEvent, decodeTask } from "./stored.js";

/** Narrows an owner's tasks to a conversation, a repository or unarchived tasks. */
export interface TaskFilters {
  conversation?: string;
  repository?: string;
  /** Leaves out tasks the user archived. */
  unarchived?: boolean;
}

/** The condition for an owner's tasks that match `filters`. */
export const taskFilters = (owner: string, filters: TaskFilters) =>
  and(
    eq(tasks.owner, owner),
    filters.conversation === undefined
      ? undefined
      : eq(tasks.conversation_id, filters.conversation),
    filters.repository === undefined
      ? undefined
      : eq(
          sql`json_extract(${tasks.body}, '$.repository')`,
          filters.repository,
        ),
    filters.unarchived
      ? sql`not exists (select 1 from ${taskArchive} where ${taskArchive.task_id} = ${tasks.id})`
      : undefined,
  );

/** The decoded tasks matching `where`, in `order`, up to `limit`. */
export function readTasks(
  orm: Database["orm"],
  where: SQL | undefined,
  order?: SQL,
  limit?: number,
): Task[] {
  const query = orm
    .select({ id: tasks.id, body: tasks.body })
    .from(tasks)
    .where(where)
    .orderBy(...(order ? [order] : []));

  return (limit === undefined ? query : query.limit(limit))
    .all()
    .map((row) => decodeTask(row.id, row.body));
}

/**
 * The id of a task's newest event of `types`, as a subquery for a query that
 * reads `tasks`. Each task's lookup searches its own events by type.
 */
function newestEvent(orm: Database["orm"], types: readonly string[]) {
  const latest = alias(events, "latest");

  const id = orm
    .select({ id: max(latest.id) })
    .from(latest)
    .where(and(eq(latest.task_id, tasks.id), inArray(latest.type, types)));

  return sql<number | null>`(${id})`;
}

/** What the owner has read of each task matching `where`, by task id. */
export function readStates(
  orm: Database["orm"],
  where: SQL | undefined,
): Map<string, ReadState> {
  const rows = orm
    .select({
      id: tasks.id,
      through: taskRead.through,
      unread: taskRead.unread,
      latest: newestEvent(orm, READ_EVENTS),
    })
    .from(tasks)
    .leftJoin(taskRead, eq(taskRead.task_id, tasks.id))
    .where(where)
    .all();

  return new Map(
    rows.map((row) => {
      const mark =
        row.through === null
          ? undefined
          : { through: row.through, unread: Boolean(row.unread) };

      return [
        row.id,
        {
          unread: isUnread(row.latest ?? 0, mark),
          through: mark?.through ?? 0,
        },
      ];
    }),
  );
}

/** Each matching task's newest event of a type, by task id. */
export function latestEvents(
  orm: Database["orm"],
  where: SQL | undefined,
  type: string,
): Map<string, Event> {
  const rows = orm
    .select(eventColumns)
    .from(tasks)
    .innerJoin(events, eq(events.id, newestEvent(orm, [type])))
    .where(where)
    .all();

  return new Map(rows.map((row) => [row.task_id, decodeEvent(row)]));
}

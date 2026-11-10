import { and, eq, inArray, max, not, or, type SQL, sql } from "drizzle-orm";
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

/** Which tasks a list takes by archive state. */
export const archivedFilters = ["exclude", "include", "only"] as const;

/** Narrows an owner's tasks by conversation, repository and archive state. */
export interface TaskFilters {
  conversation?: string;
  repository?: string;
  /** Leaves archived tasks out, lists them too or lists only them. Omitted includes them. */
  archived?: (typeof archivedFilters)[number];
  /** Tasks to return whatever the other filters say. */
  include?: readonly string[];
  /** Only these tasks. */
  ids?: readonly string[];
}

/** A task the user archived. */
const archived = sql`exists (select 1 from ${taskArchive} where ${taskArchive.task_id} = ${tasks.id})`;

const readEventTypes = sql.join(
  READ_EVENTS.map((type) => sql`${type}`),
  sql`, `,
);

/**
 * A completed task the owner has read, as `isUnread` decides: no
 * `READ_EVENTS` event after its read mark, and not marked unread.
 */
const readCompleted = sql<number>`${tasks.status} = 'completed' and coalesce((select max(read_event.id) from ${events} read_event where read_event.task_id = ${tasks.id} and read_event.type in (${readEventTypes})), 0) <= coalesce((select iif(${taskRead.unread}, -1, ${taskRead.through}) from ${taskRead} where ${taskRead.task_id} = ${tasks.id}), 0)`;

/** The condition for an owner's tasks that match `filters`. */
export function taskFilters(owner: string, filters: TaskFilters) {
  const matching = and(
    filters.conversation === undefined
      ? undefined
      : eq(tasks.conversation_id, filters.conversation),
    filters.repository === undefined
      ? undefined
      : eq(
          sql`json_extract(${tasks.body}, '$.repository')`,
          filters.repository,
        ),
    filters.archived === "only" ? archived : undefined,
    filters.archived === "exclude" ? not(archived) : undefined,
    filters.ids === undefined ? undefined : inArray(tasks.id, [...filters.ids]),
  );

  return and(
    eq(tasks.owner, owner),
    matching && filters.include?.length
      ? or(inArray(tasks.id, filters.include), matching)
      : matching,
  );
}

/**
 * Each task matching `where`, in `order`, with its repository and whether
 * it is a completed task the owner has read. Bodies stay undecoded.
 */
export function readCompletedFlags(
  orm: Database["orm"],
  where: SQL | undefined,
  order: SQL,
) {
  return orm
    .select({
      id: tasks.id,
      repository: sql<string>`json_extract(${tasks.body}, '$.repository')`,
      readCompleted: sql<number>`${readCompleted}`.mapWith(Boolean),
    })
    .from(tasks)
    .where(where)
    .orderBy(order)
    .all();
}

/** Whether any owner has a task with this id. */
export function taskExists(orm: Database["orm"], id: string) {
  return !!orm
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.id, id))
    .get();
}

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

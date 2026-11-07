import { and, eq, type SQL, sql } from "drizzle-orm";

import type { Task } from "../../../../shared/tasks/model.js";
import type { Database } from "../../../platform/database/database.js";
import { tasks } from "./schema.js";
import { decodeTask } from "./stored.js";

/** Narrows an owner's tasks to a conversation or repository. */
export interface TaskFilters {
  conversation?: string;
  repository?: string;
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

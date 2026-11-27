import {
  and,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  type SQL,
} from "drizzle-orm";

import type { Event } from "../../../../shared/events/types.js";
import type { Task } from "../../../../shared/tasks/model.js";
import type { Database } from "../../../platform/database/database.js";
import { eventColumns } from "./event-records.js";
import { events, parentPending, taskArchive, tasks } from "./schema.js";
import type { Store } from "./store.js";
import { decodeEvent } from "./stored.js";

/**
 * Clears a task's requests other than its current one. `Store.save` calls it,
 * and `insertEvent` adds the rows.
 */
export function clearEndedRequests(orm: Database["orm"], t: Task) {
  const current = t.pending_input?.id;

  orm
    .delete(parentPending)
    .where(
      and(
        eq(parentPending.task_id, t.id),
        isNotNull(parentPending.request_id),
        current === undefined
          ? undefined
          : ne(parentPending.request_id, current),
      ),
    )
    .run();
}

/**
 * Worker updates the parent agent still has to pick up. A message read clears
 * the updates it returns, and the user can clear them from the panel.
 */
export class PendingUpdateStore {
  constructor(private store: Store) {}

  private get orm() {
    return this.store.database.orm;
  }

  /** Clears a task's updates after event `after` through `through`. */
  clearRange(owner: string, id: string, after: number, through: number) {
    this.delete(
      owner,
      and(
        eq(parentPending.task_id, id),
        gt(parentPending.event_id, after),
        lte(parentPending.event_id, through),
      ),
    );
  }

  /** Clears an owner's updates with these event ids. */
  clear(owner: string, ids: number[]) {
    if (ids.length) this.delete(owner, inArray(parentPending.event_id, ids));
  }

  private delete(owner: string, where: SQL | undefined) {
    const owned = this.orm
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, parentPending.task_id), eq(tasks.owner, owner)));

    const cleared = this.orm
      .delete(parentPending)
      .where(and(where, exists(owned)))
      .run();

    if (cleared.changes) this.store.markChanged(owner);
  }

  /**
   * Pending update events, oldest first, from an owner's tasks in a
   * conversation. Archived tasks are left out.
   */
  pending(owner: string, conversation: string): Event[] {
    return this.orm
      .select(eventColumns)
      .from(parentPending)
      .innerJoin(tasks, eq(tasks.id, parentPending.task_id))
      .innerJoin(events, eq(events.id, parentPending.event_id))
      .leftJoin(taskArchive, eq(taskArchive.task_id, parentPending.task_id))
      .where(
        and(
          eq(tasks.owner, owner),
          eq(tasks.conversation_id, conversation),
          isNull(taskArchive.task_id),
        ),
      )
      .orderBy(parentPending.event_id)
      .all()
      .map(decodeEvent);
  }
}

import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  notExists,
  type SQL,
} from "drizzle-orm";

import type { Event } from "../../../../shared/events/types.js";
import { PARENT_UPDATE_EVENTS } from "../../../../shared/tasks/conversation/parent-updates.js";
import { eventColumns } from "./event-records.js";
import { events, parentSeen, taskArchive, tasks } from "./schema.js";
import type { Store } from "./store.js";
import { decodeEvent } from "./stored.js";

/**
 * Which worker updates the parent agent has seen. A message read records the
 * updates it returns, and the user can mark updates seen from the panel.
 */
export class ParentSeenStore {
  constructor(private store: Store) {}

  private get orm() {
    return this.store.database.orm;
  }

  /** Records a task's updates after event `after` through `through` as seen. */
  markRange(owner: string, id: string, after: number, through: number) {
    this.insert(
      owner,
      and(
        eq(events.task_id, id),
        gt(events.id, after),
        lte(events.id, through),
      ),
    );
  }

  /** Records an owner's updates with these event ids as seen. */
  markEvents(owner: string, ids: number[]) {
    if (ids.length) this.insert(owner, inArray(events.id, ids));
  }

  private insert(owner: string, where: SQL | undefined) {
    const updates = this.orm
      .select({ event_id: events.id })
      .from(events)
      .innerJoin(tasks, eq(tasks.id, events.task_id))
      .where(
        and(
          eq(tasks.owner, owner),
          inArray(events.type, PARENT_UPDATE_EVENTS),
          where,
        ),
      );

    const added = this.orm
      .insert(parentSeen)
      .select(updates)
      .onConflictDoNothing()
      .run();

    if (added.changes) this.store.markChanged(owner);
  }

  /**
   * Update events the parent hasn't seen, oldest first, from an owner's tasks
   * in a conversation. Archived tasks are left out.
   */
  unseen(owner: string, conversation: string): Event[] {
    return this.orm
      .select(eventColumns)
      .from(events)
      .innerJoin(tasks, eq(tasks.id, events.task_id))
      .leftJoin(taskArchive, eq(taskArchive.task_id, events.task_id))
      .where(
        and(
          eq(tasks.owner, owner),
          eq(tasks.conversation_id, conversation),
          isNull(taskArchive.task_id),
          inArray(events.type, PARENT_UPDATE_EVENTS),
          notExists(
            this.orm
              .select({ id: parentSeen.event_id })
              .from(parentSeen)
              .where(eq(parentSeen.event_id, events.id)),
          ),
        ),
      )
      .orderBy(events.id)
      .all()
      .map(decodeEvent);
  }
}

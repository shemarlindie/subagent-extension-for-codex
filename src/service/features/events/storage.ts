import { and, asc, eq, lte } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/zod";

import { type Database } from "../../platform/database/database.js";
import { checkStored } from "../../platform/database/decode.js";
import { eventCheckpoint, eventOutbox, eventSubscriptions } from "./schema.js";

const outboxRowSchema = createSelectSchema(eventOutbox);

/** A queued webhook delivery. */
export type OutboxRow = typeof eventOutbox.$inferSelect;

/** Persistence for webhook subscriptions, their outbox and the capture checkpoint. */
export class EventStorage {
  constructor(private database: Database) {}

  private get orm() {
    return this.database.orm;
  }

  saveSubscription(id: string, owner: string, body: string) {
    this.orm
      .insert(eventSubscriptions)
      .values({ id, owner, body })
      .onConflictDoUpdate({ target: eventSubscriptions.id, set: { body } })
      .run();
  }

  /** A subscription's body, scoped to its owner when one is given. */
  subscription(id: string, owner?: string): string | undefined {
    return this.orm
      .select({ body: eventSubscriptions.body })
      .from(eventSubscriptions)
      .where(
        and(
          eq(eventSubscriptions.id, id),
          owner === undefined ? undefined : eq(eventSubscriptions.owner, owner),
        ),
      )
      .get()?.body;
  }

  subscriptions(): { id: string; body: string }[] {
    return this.orm
      .select({ id: eventSubscriptions.id, body: eventSubscriptions.body })
      .from(eventSubscriptions)
      .all();
  }

  /** Deletes an owner's subscription and stops its queued deliveries. */
  unsubscribe(id: string, owner: string) {
    this.database.transaction(() => {
      this.orm
        .delete(eventSubscriptions)
        .where(
          and(
            eq(eventSubscriptions.id, id),
            eq(eventSubscriptions.owner, owner),
          ),
        )
        .run();

      this.orm
        .update(eventOutbox)
        .set({ status: "dead" })
        .where(eq(eventOutbox.subscription_id, id))
        .run();
    });
  }

  /** The id of the last task event captured into the outbox. */
  cursor(): number {
    return this.orm
      .select({ cursor: eventCheckpoint.cursor })
      .from(eventCheckpoint)
      .where(eq(eventCheckpoint.id, 1))
      .get()!.cursor;
  }

  advance(cursor: number) {
    this.orm
      .update(eventCheckpoint)
      .set({ cursor })
      .where(eq(eventCheckpoint.id, 1))
      .run();
  }

  /** Queues a delivery once; capturing the same event again changes nothing. */
  enqueue(
    subscriptionId: string,
    eventId: string,
    taskId: string,
    body: string,
  ) {
    this.orm
      .insert(eventOutbox)
      .values({
        subscription_id: subscriptionId,
        event_id: eventId,
        task_id: taskId,
        body,
      })
      .onConflictDoNothing()
      .run();
  }

  /** Up to 100 deliveries ready by `now`, earliest first. */
  ready(now: number): OutboxRow[] {
    return this.orm
      .select()
      .from(eventOutbox)
      .where(
        and(eq(eventOutbox.status, "ready"), lte(eventOutbox.next_at, now)),
      )
      .orderBy(asc(eventOutbox.next_at))
      .limit(100)
      .all()
      .map((row) =>
        checkStored(
          outboxRowSchema,
          row,
          `webhook delivery ${row.subscription_id}/${row.event_id}`,
        ),
      );
  }

  retry(row: OutboxRow, attempts: number, nextAt: number) {
    this.orm
      .update(eventOutbox)
      .set({ attempts, next_at: nextAt })
      .where(this.key(row))
      .run();
  }

  finish(row: OutboxRow, status: string) {
    this.orm.update(eventOutbox).set({ status }).where(this.key(row)).run();
  }

  private key(row: OutboxRow) {
    return and(
      eq(eventOutbox.subscription_id, row.subscription_id),
      eq(eventOutbox.event_id, row.event_id),
    );
  }
}

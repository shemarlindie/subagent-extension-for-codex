import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { tasks } from "../tasks/storage/schema.js";

export const eventSubscriptions = sqliteTable("event_subscriptions", {
  id: text().primaryKey(),
  owner: text().notNull(),
  body: text().notNull(),
});

/** Webhook deliveries; `event_id` is the envelope's public `evt_<task id>_<event id>`. */
export const eventOutbox = sqliteTable(
  "event_outbox",
  {
    subscription_id: text().notNull(),
    event_id: text().notNull(),
    task_id: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    body: text().notNull(),
    status: text().notNull().default("ready"),
    attempts: integer().notNull().default(0),
    next_at: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.subscription_id, t.event_id] }),
    index("event_outbox_task").on(t.task_id),
  ],
);

/** The single row recording the last task event captured into the outbox. */
export const eventCheckpoint = sqliteTable(
  "event_checkpoint",
  {
    id: integer().primaryKey(),
    cursor: integer().notNull(),
  },
  (t) => [check("event_checkpoint_singleton", sql`${t.id} = 1`)],
);

import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Tasks keep their state as a JSON body; `owner` scopes every lookup. */
export const tasks = sqliteTable("tasks", {
  id: text().primaryKey(),
  owner: text().notNull(),
  body: text().notNull(),
});

export const events = sqliteTable(
  "events",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    task_id: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    type: text().notNull(),
    timestamp: text().notNull(),
    data: text().notNull(),
  },
  (t) => [index("events_task").on(t.task_id, t.id)],
);

/**
 * What the user has read of each task: its events through `through`, and
 * whether they marked it unread since. A task without a row has been read
 * through none of its events.
 */
export const taskRead = sqliteTable("task_read", {
  task_id: text()
    .primaryKey()
    .references(() => tasks.id, { onDelete: "cascade" }),
  through: integer().notNull(),
  unread: integer({ mode: "boolean" }).notNull(),
});

/** Accepted send receipts share the message transaction and survive restart. */
export const sendReceipts = sqliteTable(
  "task_send_receipts",
  {
    owner: text().notNull(),
    task_id: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    sender: text().notNull(),
    request_id: text().notNull(),
    fingerprint: text().notNull(),
    message_id: text().notNull(),
    state: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.owner, t.task_id, t.sender, t.request_id] }),
  ],
);

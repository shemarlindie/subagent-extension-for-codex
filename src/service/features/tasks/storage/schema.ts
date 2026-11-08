import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** A virtual column holding a field of the task's JSON body. */
const bodyField = (field: string) =>
  text().generatedAlwaysAs(sql.raw(`json_extract(body, '$.${field}')`), {
    mode: "virtual",
  });

/**
 * Tasks keep their state as a JSON body; `owner` scopes every lookup. The
 * body fields that task reads filter and sort on are indexed generated
 * columns.
 */
export const tasks = sqliteTable(
  "tasks",
  {
    id: text().primaryKey(),
    owner: text().notNull(),
    body: text().notNull(),
    status: bodyField("status"),
    created_at: bodyField("created_at"),
    conversation_id: bodyField("conversation_id"),
  },
  (t) => [
    index("tasks_owner_created").on(t.owner, t.created_at),
    index("tasks_owner_conversation").on(
      t.owner,
      t.conversation_id,
      t.created_at,
    ),
    index("tasks_status").on(t.status),
  ],
);

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
    response_ref: text(),
    original_response: text(),
    /** Whether Chat shows the event, as `isChatEvent` decides. */
    chat: integer({ mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    index("events_task").on(t.task_id, t.id),
    index("events_task_type").on(t.task_id, t.type, t.id),
    index("events_task_chat").on(t.task_id, t.chat, t.id),
    uniqueIndex("events_response").on(t.response_ref),
  ],
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

/**
 * Worker updates the parent agent has seen, by event: those a message read
 * returned to it and those the user marked seen. An update without a row is
 * pending.
 */
export const parentSeen = sqliteTable("task_parent_seen", {
  event_id: integer()
    .primaryKey()
    .references(() => events.id, { onDelete: "cascade" }),
});

/**
 * Tasks the user archived to keep them out of the panel's task lists, and
 * when. A task without a row isn't archived.
 */
export const taskArchive = sqliteTable("task_archive", {
  task_id: text()
    .primaryKey()
    .references(() => tasks.id, { onDelete: "cascade" }),
  archived_at: text().notNull(),
});

/**
 * The messages each task's worker has received or is about to, in the order
 * it gets them. The task's `instructions_sent` counts those its session has.
 */
export const taskMessages = sqliteTable(
  "task_messages",
  {
    task_id: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    seq: integer().notNull(),
    message_id: text().notNull(),
    message: text().notNull(),
    sender: text({ enum: ["user", "parent"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.task_id, t.seq] })],
);

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

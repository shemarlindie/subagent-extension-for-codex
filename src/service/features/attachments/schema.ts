import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import {
  attachmentFormats,
  attachmentSources,
} from "../../../core/shared/attachments/model.js";
import { tasks } from "../tasks/storage/schema.js";

/** Each attachment's metadata. Its content is a file in the task's folder. */
export const taskAttachments = sqliteTable(
  "task_attachments",
  {
    task_id: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    /** The message it came with: a follow-up's id, or `request`. */
    message_id: text().notNull(),
    /** Its place in that message, from 1. */
    position: integer().notNull(),
    title: text().notNull(),
    summary: text().notNull(),
    format: text({ enum: attachmentFormats }).notNull(),
    path: text(),
    source: text({ enum: attachmentSources }).notNull(),
    file: text().notNull(),
    bytes: integer(),
    mime_type: text(),
    chars: integer().notNull(),
    lines: integer().notNull(),
    files: integer(),
    additions: integer(),
    deletions: integer(),
    /** The paths a diff was limited to. NULL means the whole project. */
    paths: text({ mode: "json" }).$type<string[]>(),
    /** A ranged file reference's copied lines. NULL means the whole file. */
    start_line: integer(),
    end_line: integer(),
  },
  (t) => [primaryKey({ columns: [t.task_id, t.message_id, t.position] })],
);

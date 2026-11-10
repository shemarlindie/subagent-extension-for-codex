import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import {
  attachmentFormats,
  attachmentSources,
} from "../../../shared/attachments/model.js";
import { tasks } from "../tasks/storage/schema.js";

/** Each attachment's metadata. Its content is a file in the task's folder. */
export const taskAttachments = sqliteTable(
  "task_attachments",
  {
    task_id: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    /** The follow-up message it came with. NULL means the task's initial request. */
    message_id: text(),
    title: text().notNull(),
    summary: text().notNull(),
    format: text({ enum: attachmentFormats }).notNull(),
    path: text(),
    source: text({ enum: attachmentSources }).notNull(),
    file: text().notNull(),
    chars: integer().notNull(),
    lines: integer().notNull(),
    files: integer(),
    additions: integer(),
    deletions: integer(),
  },
  (t) => [primaryKey({ columns: [t.task_id, t.position] })],
);

import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { tasks } from "../tasks/storage/schema.js";

export const fileChanges = sqliteTable(
  "file_changes",
  {
    task_id: text()
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    scope: text({ enum: ["task", "turn"] }).notNull(),
    path: text().notNull(),
    hunks: text().notNull(),
    created: integer({ mode: "boolean" }).notNull(),
    deleted: integer({ mode: "boolean" }).notNull(),
    source: text({ enum: ["tool", "command"] }).notNull(),
    incomplete: integer({ mode: "boolean" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.task_id, t.scope, t.path] })],
);

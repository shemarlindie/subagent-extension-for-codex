import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projectRoots = sqliteTable("project_roots", {
  path: text().primaryKey(),
  kind: text().notNull(),
  name: text(),
});

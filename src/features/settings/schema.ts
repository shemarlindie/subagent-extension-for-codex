import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const userSettings = sqliteTable("user_settings", {
  owner: text().primaryKey(),
  body: text().notNull(),
});

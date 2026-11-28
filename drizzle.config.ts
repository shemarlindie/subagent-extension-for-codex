import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/core/service/platform/database/schema.ts",
  out: "./migrations",
});

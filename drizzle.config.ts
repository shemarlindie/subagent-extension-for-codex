import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/service/platform/database/schema.ts",
  out: "./migrations",
});

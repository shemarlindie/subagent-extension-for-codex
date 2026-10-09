import type { events } from "../tasks/schema.js";

/** An event row with its JSON data column decoded. */
export type Event = Omit<typeof events.$inferSelect, "data"> & {
  data: Record<string, unknown>;
};

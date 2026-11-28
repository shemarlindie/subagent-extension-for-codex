import { z } from "zod";

import type { Control } from "../../../features/tasks/runtime/control.js";
import { tool } from "./definition.js";

/** Clears worker updates pending for Codex. A view reads them. */
export function pendingUpdateTools(c: Control, owner: string) {
  return {
    app_mark_updates_seen: tool({
      description:
        "User interface only: clear worker updates pending for Codex, by event.",
      schema: z.strictObject({
        event_ids: z.array(z.number().int().positive()).min(1).max(1000),
      }),
      run: (a) => {
        c.pendingUpdates.clear(owner, a.event_ids);

        return { event_ids: a.event_ids };
      },
    }),
  };
}

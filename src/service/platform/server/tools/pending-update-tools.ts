import { z } from "zod";

import type { Control } from "../../../features/tasks/runtime/control.js";
import { tool } from "./definition.js";

/** Marks the worker updates Codex hasn't seen. A view reads them. */
export function pendingUpdateTools(c: Control, owner: string) {
  return {
    app_mark_updates_seen: tool({
      description:
        "User interface only: record worker updates as seen by Codex, by event, so they no longer count as pending.",
      schema: z.strictObject({
        event_ids: z.array(z.number().int().positive()).min(1).max(1000),
      }),
      run: (a) => {
        c.parentSeen.markEvents(owner, a.event_ids);

        return { event_ids: a.event_ids };
      },
    }),
  };
}

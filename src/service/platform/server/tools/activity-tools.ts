import { z } from "zod";

import type { Control } from "../../../features/tasks/runtime/control.js";
import { taskId, tool } from "./definition.js";

/** App-only reads for a task's Activity and Changes tabs and Details. */
export function activityTools(c: Control, owner: string) {
  return {
    app_get_change_counts: tool({
      readOnly: true,
      description:
        "User interface only: recorded change totals for the Changes tab and Details.",
      schema: taskId,
      run: (a) => c.changes.counts(c.store.get(a.task_id, owner)),
    }),
    app_get_original_response: tool({
      readOnly: true,
      description:
        "User interface only: resolve one original response belonging to this task. Missing originals return unavailable.",
      schema: taskId.extend({ response_ref: z.string().min(1) }),
      run: (a) => {
        const original = c.store.originalResponse(
          a.task_id,
          owner,
          a.response_ref,
        );

        return original === undefined
          ? { available: false }
          : { available: true, original };
      },
    }),
    app_get_activity: tool({
      readOnly: true,
      description:
        "User interface only: a task's activity for the panel's Activity tab: its newest events after a cursor, and a tally of the older events outside the window (the summary's count, timestamps, tool calls, messages, failures and retries).",
      schema: taskId.extend({
        after: z.number().int().nonnegative().default(0),
      }),
      run: (a) => {
        c.store.get(a.task_id, owner);

        return c.activity.page(a.task_id, a.after);
      },
    }),
    app_get_turn_activity: tool({
      readOnly: true,
      description:
        "User interface only: one turn's activity for the panel's Activity tab: the events after the previous turn's closing status event through this turn's, or to the newest event while the turn runs. Its newest events come with a tally of the older ones, as app_get_activity gives them.",
      schema: taskId.extend({ turn: z.number().int().positive() }),
      run: (a) => {
        c.store.get(a.task_id, owner);

        return c.activity.turn(a.task_id, a.turn);
      },
    }),
  };
}

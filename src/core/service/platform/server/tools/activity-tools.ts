import { z } from "zod";

import type { Control } from "../../../features/tasks/runtime/control.js";
import { taskId, tool } from "./definition.js";

const changeScope = taskId.extend({ scope: z.enum(["task", "turn"]) });

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
    app_get_change_list: tool({
      readOnly: true,
      description:
        "User interface only: the Changes tab's file list and totals with each file's signature and the list's revision, without diffs.",
      schema: changeScope,
      run: (a) => c.changes.changeList(c.store.get(a.task_id, owner), a.scope),
    }),
    app_get_file_change: tool({
      readOnly: true,
      description:
        "User interface only: one listed file's diff for the Changes tab. Stale once the recorded changes no longer match revision. Incomplete files have no diff.",
      schema: changeScope.extend({
        path: z.string().min(1).max(4096),
        revision: z.string().max(100),
      }),
      run: (a) =>
        c.changes.fileChange(
          c.store.get(a.task_id, owner),
          a.scope,
          a.path,
          a.revision,
        ),
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
    app_get_turn_activity: tool({
      readOnly: true,
      description:
        "User interface only: one turn's activity for the panel's Activity tab: the events after the previous turn's closing status event through this turn's, or to the newest event while the turn runs. Its newest events come with a tally of the older ones, as a view's Activity gives them.",
      schema: taskId.extend({ turn: z.number().int().positive() }),
      run: (a) => {
        c.store.get(a.task_id, owner);

        return c.activity.turn(a.task_id, a.turn);
      },
    }),
  };
}

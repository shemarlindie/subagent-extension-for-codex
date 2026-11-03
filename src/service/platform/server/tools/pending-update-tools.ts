import { z } from "zod";

import { pendingUpdates } from "../../../features/tasks/conversation/parent-updates.js";
import type { Control } from "../../../features/tasks/runtime/control.js";
import { tool } from "./definition.js";

/** App-only tools for the worker updates Codex hasn't seen. */
export function pendingUpdateTools(c: Control, owner: string) {
  return {
    app_list_pending_updates: tool({
      readOnly: true,
      description:
        "User interface only: the worker updates Codex hasn't seen in a conversation, grouped by task: turn replies, failures, budget stops and requests Codex may answer. Tasks and their updates are newest first. Archived tasks are left out.",
      schema: z.strictObject({ conversation_id: z.string().min(1) }),
      run: (a) => ({
        tasks: pendingUpdates(
          c.store,
          c.parentSeen,
          (t) =>
            c.providers.get(t.provider)?.taskPolicy.parentMayApprove(t) ??
            false,
          owner,
          a.conversation_id,
        ),
      }),
    }),
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

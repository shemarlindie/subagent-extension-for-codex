import { z } from "zod";

import type { Control } from "../../../features/tasks/runtime/control.js";
import { queuedMessage, taskId, tool } from "./definition.js";

/** App-only tools for the user's changes to a task's message queue. */
export function queueTools(c: Control, owner: string) {
  return {
    app_steer_queued_message: tool({
      description:
        "User interface only: send a queued message into the busy task as a steer, preserving its sender and identity. Unavailable while the worker waits for input.",
      schema: queuedMessage,
      run: (a) => c.steerQueued(owner, a.task_id, a.message_id),
    }),
    app_edit_queued_message: tool({
      description:
        "User interface only: change a queued message's text before its turn starts.",
      schema: queuedMessage.extend({ message: z.string().min(1).max(20000) }),
      run: (a) => c.editQueued(owner, a.task_id, a.message_id, a.message),
    }),
    app_move_queued_message: tool({
      description:
        "User interface only: move a queued message to a zero-based position in the queue, after any steers the worker already has.",
      schema: queuedMessage.extend({
        index: z.number().int().nonnegative(),
      }),
      run: (a) => c.moveQueued(owner, a.task_id, a.message_id, a.index),
    }),
    app_remove_queued_message: tool({
      description:
        "User interface only: remove a queued message, whoever queued it, before its turn starts.",
      schema: queuedMessage,
      run: (a) => c.removeQueued(owner, a.task_id, a.message_id, "user"),
    }),
    app_resume_queue: tool({
      description:
        "User interface only: resume a task's paused queue; an idle task starts its next queued message.",
      schema: taskId,
      run: (a) => c.resumeQueue(owner, a.task_id),
    }),
    app_clear_queue: tool({
      description:
        "User interface only: remove the listed queued messages, or every queued message without message_ids.",
      schema: taskId.extend({
        message_ids: z.array(z.string().max(200)).min(1).max(1000).optional(),
      }),
      run: (a) => c.clearQueue(owner, a.task_id, a.message_ids),
    }),
    app_restore_queued_messages: tool({
      description:
        "User interface only: undo the removal of queued messages, putting each back at a zero-based queue position with its original text, sender and identity. Messages sent or queued since are left as they are. Restoring never starts a turn: a task that isn't busy keeps its queue paused. An archived task is unarchived.",
      schema: taskId.extend({
        messages: z
          .array(
            z.strictObject({
              message_id: z.string().max(200),
              index: z.number().int().nonnegative(),
            }),
          )
          .min(1)
          .max(1000),
      }),
      run: (a) => c.restoreQueued(owner, a.task_id, a.messages),
    }),
  };
}

import { z } from "zod";

import type { Control } from "../../../features/tasks/runtime/control.js";
import { taskId, tool } from "./definition.js";

/**
 * App-only tools for how the user keeps tasks: titles, read state, archive,
 * deletion and worktree cleanup.
 */
export function taskLifecycleTools(c: Control, owner: string) {
  return {
    app_remove_worktree: tool({
      destructive: true,
      description:
        "User interface only: remove a stopped worktree task's worktree and keep its branch. With uncommitted changes it removes nothing and returns status uncommitted with the files, unless force discards them.",
      schema: taskId.extend({ force: z.boolean().default(false) }),
      run: (a) => c.removeWorktree(owner, a.task_id, a.force),
    }),
    app_rename_task: tool({
      description: "User interface only: change a task's display title.",
      schema: taskId.extend({ title: z.string().trim().min(1).max(200) }),
      run: (a) => c.rename(owner, a.task_id, a.title),
    }),
    app_set_task_read: tool({
      description:
        "User interface only: record whether the user has read a task's replies, outcomes and requests. read true records them read through event through, the newest event the panel has shown, or through the task's newest event without it. read false marks the task unread until the user next sees it. Returns whether the task is still unread, and through, the newest event the user has read.",
      schema: taskId.extend({
        read: z.boolean(),
        through: z.number().int().nonnegative().optional(),
      }),
      run: (a) => {
        const t = c.store.get(a.task_id, owner);

        if (a.read) c.store.markRead(t, a.through);
        else c.store.markUnread(t);

        return c.store.readState(t.id);
      },
    }),
    app_mark_task_unread_from: tool({
      description:
        "User interface only: mark a task unread from event event_id on, so the replies, outcomes and requests from that event are new while earlier events stay read. Returns whether the task is still unread, and through, the newest event the user has read.",
      schema: taskId.extend({ event_id: z.number().int().positive() }),
      run: (a) => {
        const t = c.store.get(a.task_id, owner);

        c.store.markUnreadFrom(t, a.event_id);

        return c.store.readState(t.id);
      },
    }),
    app_mark_tasks_read: tool({
      description:
        "User interface only: record that the user has read every reply, outcome and request of these tasks so far.",
      schema: z.strictObject({
        task_ids: z.array(z.string()).min(1).max(1000),
      }),
      run: (a) => {
        const marked = a.task_ids.map((id) => c.store.get(id, owner));

        c.store.transaction(() => {
          for (const t of marked) c.store.markRead(t);
        });

        return { task_ids: marked.map((t) => t.id) };
      },
    }),
    app_set_tasks_archived: tool({
      description:
        "User interface only: archive or unarchive tasks. Archived tasks leave the panel's task lists until unarchived or sent a message. Archiving skips tasks that haven't stopped or that have a pending request or queued messages. Returns task_ids, the tasks changed, and skipped.",
      schema: z.strictObject({
        task_ids: z.array(z.string()).min(1).max(1000),
        archived: z.boolean(),
      }),
      run: (a) => c.archive.setArchived(owner, a.task_ids, a.archived),
    }),
    app_delete_tasks: tool({
      destructive: true,
      description:
        "User interface only: delete stopped tasks with their events, requests, worktrees and branches. With delete_agent_task it also deletes each provider session. This can't be undone.",
      schema: z.strictObject({
        task_ids: z.array(z.string()).min(1).max(1000),
        delete_agent_task: z.boolean().default(false),
      }),
      run: (a) => c.delete(owner, a.task_ids, a.delete_agent_task),
    }),
    app_delete_branch: tool({
      destructive: true,
      description:
        "User interface only: delete a stopped worktree task's branch once its worktree is removed.",
      schema: taskId,
      run: (a) => c.deleteBranch(owner, a.task_id),
    }),
  };
}

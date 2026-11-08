import { z } from "zod";

import { MAX_UPDATE_WAIT_MS } from "../../../../shared/tasks/conversation/drafts.js";
import { chatRead } from "../../../features/tasks/conversation/chat-read.js";
import { waitForUpdates } from "../../../features/tasks/conversation/updates.js";
import type { Control } from "../../../features/tasks/runtime/control.js";
import { panelTaskList } from "../../panel/panel-context.js";
import type { activityTools } from "./activity-tools.js";
import { archivedFilter, taskId, tool } from "./definition.js";
import type { pendingUpdateTools } from "./pending-update-tools.js";

/** The other tools a panel view reads through. */
type ViewReads = {
  activity: ReturnType<typeof activityTools>["app_get_activity"];
  pending: ReturnType<typeof pendingUpdateTools>["app_list_pending_updates"];
};

/**
 * App-only reads the panel refreshes from: its task list, Chat, and the
 * update wait, which can return them with projects, Activity and pending
 * updates as one view.
 */
export function panelViewTools(c: Control, owner: string, reads: ViewReads) {
  const list = tool({
    readOnly: true,
    description:
      "User interface only: { tasks, read_completed }, the tasks the panel lists, newest first. Each has its full state except the conversation and context, with its latest reply excerpt, live activity, draft, read state and archive time. include names tasks to list whatever the filters say. Unless include_read_completed is true, completed tasks the user has read are left out, except included ones and the newest, and read_completed counts them by repository.",
    schema: z.object({
      conversation_id: z.string().nullable().optional(),
      repository: z.string().optional(),
      archived: archivedFilter,
      include: z.array(z.string()).max(10).optional(),
      include_read_completed: z.boolean().default(false),
    }),
    run: (a) =>
      panelTaskList(
        c,
        owner,
        {
          conversation: a.conversation_id || undefined,
          repository: a.repository || undefined,
          archived: a.archived,
          include: a.include,
        },
        a.include_read_completed,
      ),
  });

  const chat = tool({
    readOnly: true,
    description:
      "User interface only: a task's Chat after a cursor: its messages, an outcome row for each turn's end, and notes for a new session, a recreated worktree and compaction. An item read again replaces the earlier one with its id.",
    schema: taskId.extend({
      after: z.number().int().nonnegative().default(0),
    }),
    run: (a) => chatRead(c.store, c.store.get(a.task_id, owner), a.after),
  });

  const view = z.strictObject({
    list: list.schema,
    chat: chat.schema.optional(),
    activity: reads.activity.schema.optional(),
    pending: reads.pending.schema.optional(),
  });

  /**
   * Git state is read first, since it waits on Git. Everything else, the
   * project list included, reads in one synchronous section, so it matches
   * the revision.
   */
  const readView = async (parts: z.output<typeof view>) => {
    const known = (await c.projects?.listWithGit()) ?? [];
    const owned = (id: string) => !!c.store.find(id, owner);

    return () =>
      c.store.reads.measure("view", (work) => {
        const read = {
          projects: c.projects?.withKnownGit(known) ?? [],
          list: list.run(parts.list),
          // A selected task that is gone or not the owner's has no details.
          ...(parts.chat &&
            owned(parts.chat.task_id) && { chat: chat.run(parts.chat) }),
          ...(parts.activity &&
            owned(parts.activity.task_id) && {
              activity: reads.activity.run(parts.activity),
            }),
          ...(parts.pending && { pending: reads.pending.run(parts.pending) }),
        };

        work.rows = read.list.tasks.length;

        return { ...read, built_at: Date.now() };
      });
  };

  return {
    app_list_tasks: list,
    app_get_chat: chat,
    app_wait_for_updates: tool({
      readOnly: true,
      description: `User interface only: waits for something the panel should show. It returns the owner's current revision as soon as it differs from after, and with a draft target, as soon as that task's draft grows past after_length, becomes another message or clears; otherwise after wait_ms (at most ${MAX_UPDATE_WAIT_MS}). Without after, or with wait_ms 0, it returns at once, so it also reads a draft. A revision is boot:count, and the count only grows within a boot. With view, which takes each part's own tool arguments (list: app_list_tasks, chat: app_get_chat, activity: app_get_activity, pending: app_list_pending_updates), it also returns view: those parts in their tools' shapes, with projects as list_projects returns them and built_at in epoch milliseconds, all as of the returned revision. It leaves view out when only the draft changed, and leaves out chat and activity for a task the owner doesn't have.`,
      schema: z.strictObject({
        after: z.string().max(200).optional(),
        draft: taskId
          .extend({
            message_id: z.string().max(200).optional(),
            after_length: z.number().int().nonnegative().default(0),
          })
          .strict()
          .optional(),
        wait_ms: z.number().int().min(0).max(MAX_UPDATE_WAIT_MS).default(0),
        view: view.optional(),
      }),
      run: ({ view: parts, ...a }) =>
        waitForUpdates(
          c.store,
          c.drafts,
          owner,
          a,
          parts && (() => readView(parts)),
        ),
    }),
  };
}

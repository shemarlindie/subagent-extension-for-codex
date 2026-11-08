import { z } from "zod";

import { MAX_UPDATE_WAIT_MS } from "../../../../shared/tasks/conversation/drafts.js";
import { chatRead } from "../../../features/tasks/conversation/chat-read.js";
import { pendingUpdates } from "../../../features/tasks/conversation/parent-updates.js";
import { waitForUpdates } from "../../../features/tasks/conversation/updates.js";
import type { Control } from "../../../features/tasks/runtime/control.js";
import { panelTaskList } from "../../panel/panel-context.js";
import { archivedFilter, taskId, tool } from "./definition.js";

/**
 * App-only reads the panel refreshes from: its task list, and the update
 * wait, which can return it with projects, Chat, Activity and pending updates
 * as one view.
 */
export function panelViewTools(c: Control, owner: string) {
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

  const cursor = taskId.extend({
    after: z.number().int().nonnegative().default(0),
  });

  const view = z.strictObject({
    list: list.schema,
    chat: cursor.optional(),
    activity: cursor.optional(),
    pending: z.strictObject({ conversation_id: z.string().min(1) }).optional(),
  });

  /**
   * Git state is read first, since it waits on Git. Everything else, the
   * project list included, reads in one synchronous section, so it matches
   * the revision.
   */
  const readView = async (parts: z.output<typeof view>) => {
    const known = (await c.projects?.listWithGit()) ?? [];
    const { chat, activity, pending } = parts;

    return () =>
      c.store.reads.measure("view", (work) => {
        // A selected task that is gone or not the owner's has no details.
        const chatTask = chat && c.store.find(chat.task_id, owner);
        const activityTask = activity && c.store.find(activity.task_id, owner);

        const read = {
          projects: c.projects?.withKnownGit(known) ?? [],
          list: list.run(parts.list),
          ...(chat &&
            chatTask && { chat: chatRead(c.store, chatTask, chat.after) }),
          ...(activity &&
            activityTask && {
              activity: c.activity.page(activityTask.id, activity.after),
            }),
          ...(pending && {
            pending: {
              tasks: pendingUpdates(
                c.store,
                c.parentSeen,
                (t) =>
                  c.providers.get(t.provider)?.taskPolicy.parentMayApprove(t) ??
                  false,
                owner,
                pending.conversation_id,
              ),
            },
          }),
        };

        work.rows = read.list.tasks.length;

        return { ...read, built_at: Date.now() };
      });
  };

  return {
    app_list_tasks: list,
    app_wait_for_updates: tool({
      readOnly: true,
      description: `User interface only: waits for something the panel should show. It returns the owner's current revision as soon as it differs from after, and with a draft target, as soon as that task's draft grows past after_length, becomes another message or clears; otherwise after wait_ms (at most ${MAX_UPDATE_WAIT_MS}). Without after, or with wait_ms 0, it returns at once, so it also reads a draft. A revision is boot:count, and the count only grows within a boot. With view, it also returns view as of the returned revision, with built_at in epoch milliseconds. Its projects are as list_projects returns them, and its list takes app_list_tasks arguments and returns that shape. chat { items, next_cursor } is a task's Chat after a cursor: its messages, an outcome row for each turn's end, and notes for a new session, a recreated worktree and compaction. An item read again replaces the earlier one with its id. activity { events, dropped } holds a task's newest Activity events after a cursor, with a tally of the older events outside the window. pending { tasks } lists the worker updates Codex hasn't seen in a conversation, grouped by task and newest first: turn replies, failures, budget stops and requests Codex may answer, leaving out archived tasks. The wait leaves view out when only the draft changed, and leaves out chat and activity for a task the owner doesn't have.`,
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

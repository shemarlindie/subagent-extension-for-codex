import { z } from "zod";

import {
  CHAT_EVENTS,
  chatItems,
} from "../../../../shared/tasks/conversation/chat.js";
import { MAX_UPDATE_WAIT_MS } from "../../../../shared/tasks/conversation/drafts.js";
import { budgetRaiseSchema } from "../../../../shared/tasks/model.js";
import { autoRegisterChatProject } from "../../../features/projects/chat-project.js";
import { browseProject } from "../../../features/projects/project-picker.js";
import {
  claimParentMessage,
  recordParentDelivery,
} from "../../../features/tasks/conversation/parent-messages.js";
import { waitForUpdates } from "../../../features/tasks/conversation/updates.js";
import {
  composerMentionsEnabled,
  mentionSearchSchema,
  mentionSearchToolName,
  searchAgentMentions,
} from "../mentions.js";
import type { agentTools } from "./agent-tools.js";
import { queuedMessage, taskId, tool, type ToolContext } from "./definition.js";
import { panelTimingTool } from "./panel-timing-tool.js";
import { settingsTransferTools } from "./settings-transfer-tools.js";

/**
 * App-only tools, named with an `app_` prefix. The panel calls them on the
 * user's behalf. `callTool` refuses them to other callers. Several extend
 * an agent tool with user authority.
 */
export function userTools(
  { c, owner, hostMeta }: ToolContext,
  tools: ReturnType<typeof agentTools>,
) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Temporary feature gate.
    ...(composerMentionsEnabled
      ? {
          // The host's composer calls this. The HTTP and stdio servers register it
          // with the mention extension metadata.
          [mentionSearchToolName]: tool({
            readOnly: true,
            description:
              "Search for the configured Claude provider in the composer mention picker.",
            schema: mentionSearchSchema,
            run: ({ query }) => searchAgentMentions(query, c.workers()),
          }),
        }
      : {}),
    app_register_project: tool({
      description:
        "User interface only: approve and persist a Git repository selected by the user. Does not approve its parent or nested repositories.",
      schema: z.strictObject({ repository: z.string().min(1).max(4096) }),
      run: async (a) => {
        if (!c.projects) {
          throw new Error(
            "Project registration is unavailable in this service.",
          );
        }

        return c.projects.register(a.repository);
      },
    }),
    app_browse_project: tool({
      description:
        "User interface only: open a native folder picker on the local macOS service host. Returns a path or null on cancellation; never registers a project.",
      schema: z.strictObject({}),
      run: () => browseProject(),
    }),
    app_rename_project: tool({
      description:
        "User interface only: rename a registered project without changing its repository or tasks.",
      schema: z.strictObject({
        repository: z.string().min(1).max(4096),
        name: z.string().trim().min(1).max(200),
      }),
      run: (a) => {
        if (!c.projects) {
          throw new Error("Project management is unavailable in this service.");
        }

        return c.projects.rename(a.repository, a.name);
      },
    }),
    app_remove_project: tool({
      description:
        "User interface only: remove a saved project approval. Optionally stop and delete this user's project tasks, history and task worktrees/branches; checkout files and provider sessions stay intact. External dependent tasks block deletion.",
      schema: z.strictObject({
        repository: z.string().min(1).max(4096),
        delete_tasks: z.boolean().default(false),
      }),
      run: (a) => {
        if (!c.projects) {
          throw new Error("Project management is unavailable in this service.");
        }

        return c.removeProject(owner, a.repository, a.delete_tasks);
      },
    }),
    app_start_task: tool({
      ...tools.start_task,
      // The panel already shows the new task, so it opens no inline panel.
      panel: false,
      description:
        "User interface only: create a task with the user-selected native permission mode.",
      run: async (a) => {
        await autoRegisterChatProject(c, owner, hostMeta, a.repository);

        return c.start(
          owner,
          { ...a, conversation_id: a.conversation_id ?? undefined },
          "user",
        );
      },
    }),
    app_send_message: tool({
      ...tools.send_message,
      description:
        "User interface only: send the user's message to a task, as send_message does.",
      run: async (a) => {
        const sent = await c.send(owner, a.task_id, a.message, "user", {
          delivery: a.delivery,
          budget: a.budget,
          request_id: a.request_id,
        });

        return {
          message_id: sent.message_id,
          state: sent.state,
          status: sent.task.status,
        };
      },
    }),
    app_raise_budget: tool({
      description:
        "User interface only: apply higher task budget limits without sending a message or starting a turn. Each limit can only increase or be set to null to remove the limit.",
      schema: taskId.extend({ budget: budgetRaiseSchema }),
      run: (a) => {
        const task = c.applyBudget(owner, a.task_id, a.budget);

        return { budget: task.budget, status: task.status };
      },
    }),
    app_claim_parent_message: tool({
      description:
        "User interface only: claim one queued worker message for this parent conversation. Claims are not automatically retried.",
      schema: z.object({ conversation_id: z.string().min(1) }),
      run: (a) => claimParentMessage(c.store, owner, a.conversation_id),
    }),
    app_record_parent_delivery: tool({
      description:
        "User interface only: record the host delivery result for a claimed worker message.",
      schema: taskId.extend({
        conversation_id: z.string().min(1),
        attempt_id: z.number().int().positive(),
        delivered: z.boolean(),
        skipped: z.literal("acknowledged").optional(),
        error: z.string().max(2000).optional(),
      }),
      run: (a) => {
        recordParentDelivery(
          c.store,
          owner,
          a.task_id,
          a.attempt_id,
          a.conversation_id,
          a.delivered,
          a.error,
          a.skipped,
        );

        return { recorded: true };
      },
    }),
    app_get_chat: tool({
      readOnly: true,
      description:
        "User interface only: a task's Chat after a cursor: its messages, an outcome row for each turn's end, and notes for a new session, a recreated worktree and compaction. An item read again replaces the earlier one with its id.",
      schema: taskId.extend({
        after: z.number().int().nonnegative().default(0),
      }),
      run: (a) => {
        const t = c.store.get(a.task_id, owner);
        const events = c.store.chatEvents(t.id, CHAT_EVENTS);

        return {
          items: chatItems(t, events).filter(
            (item) =>
              item.event_id > a.after || (a.after === 0 && item.event_id === 0),
          ),
          next_cursor: Math.max(a.after, events.at(-1)?.id ?? 0),
        };
      },
    }),
    app_wait_for_updates: tool({
      readOnly: true,
      description: `User interface only: waits for something the panel should show. It returns the owner's current revision as soon as it differs from after, and with a draft target, as soon as that task's draft grows past after_length, becomes another message or clears; otherwise after wait_ms (at most ${MAX_UPDATE_WAIT_MS}). Without after, or with wait_ms 0, it returns at once, so it also reads a draft. The revision is opaque: compare it only for equality.`,
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
      }),
      run: (a) => waitForUpdates(c.store, c.drafts, owner, a),
    }),
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
    app_submit_input: tool({
      ...tools.submit_input,
      description:
        "User interface only: submit the user decision for the exact pending request.",
      run: (a) =>
        c.input(
          owner,
          a.task_id,
          a.request_id,
          a.approved,
          a.input,
          a.message,
          "user",
        ),
    }),
    app_update_settings: tool({
      ...tools.update_settings,
      description:
        "User interface only: save delegation defaults, including native permission mode and approval decision maker.",
      run: (a) => c.settings.update(owner, a, "user"),
    }),
    ...settingsTransferTools(c.settings, owner),
    app_get_change_counts: tool({
      readOnly: true,
      description:
        "User interface only: recorded change totals for the Changes tab and Details.",
      schema: taskId,
      run: (a) => c.changes.counts(c.store.get(a.task_id, owner)),
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
    app_record_timing: panelTimingTool(),
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
        "User interface only: delete stopped tasks with their events, requests, worktrees and branches, dependents first. With delete_agent_task it also deletes each provider session. A task outside them that depends on one stops the whole deletion. This can't be undone.",
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

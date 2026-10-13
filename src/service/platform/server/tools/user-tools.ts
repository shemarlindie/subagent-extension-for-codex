import { z } from "zod";

import {
  CHAT_EVENTS,
  chatItems,
} from "../../../../shared/tasks/conversation/chat.js";
import { MAX_DRAFT_WAIT_MS } from "../../../../shared/tasks/conversation/drafts.js";
import { budgetRaiseSchema } from "../../../../shared/tasks/model.js";
import { autoRegisterChatProject } from "../../../features/projects/chat-project.js";
import { browseProject } from "../../../features/projects/project-picker.js";
import {
  claimParentMessage,
  recordParentDelivery,
} from "../../../features/tasks/conversation/parent-messages.js";
import type { agentTools } from "./agent-tools.js";
import { queuedMessage, taskId, tool, type ToolContext } from "./definition.js";

/**
 * Tools only the panel calls on the user's behalf; `callTool` refuses them to
 * other callers. Several extend an agent tool with user authority.
 */
export function userTools(
  { c, owner, hostMeta }: ToolContext,
  tools: ReturnType<typeof agentTools>,
) {
  return {
    register_user_agent_project: tool({
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
    browse_user_agent_project: tool({
      description:
        "User interface only: open a native folder picker on the local macOS service host. Returns a path or null on cancellation; never registers a project.",
      schema: z.strictObject({}),
      run: () => browseProject(),
    }),
    rename_user_agent_project: tool({
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
    remove_user_agent_project: tool({
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
    start_user_agent_task: tool({
      ...tools.start_agent_task,
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
    send_user_agent_message: tool({
      ...tools.send_agent_message,
      description:
        "User interface only: send the user's message to a task, as send_agent_message does.",
      run: async (a) => {
        const sent = await c.send(owner, a.task_id, a.message, "user", {
          delivery: a.delivery,
          budget: a.budget,
        });

        return {
          message_id: sent.message_id,
          state: sent.state,
          status: sent.task.status,
        };
      },
    }),
    raise_user_agent_budget: tool({
      description:
        "User interface only: apply higher task budget limits without sending a message or starting a turn. Each limit can only increase or be set to null to remove the limit.",
      schema: taskId.extend({ budget: budgetRaiseSchema }),
      run: (a) => {
        const task = c.applyBudget(owner, a.task_id, a.budget);

        return { budget: task.budget, status: task.status };
      },
    }),
    claim_user_agent_parent_message: tool({
      description:
        "User interface only: claim one queued worker message for this parent conversation. Claims are not automatically retried.",
      schema: z.object({ conversation_id: z.string().min(1) }),
      run: (a) => claimParentMessage(c.store, owner, a.conversation_id),
    }),
    record_user_agent_parent_delivery: tool({
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
    get_user_agent_chat: tool({
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
    get_user_agent_draft: tool({
      description: `User interface only: the message the worker is writing in a running task. It returns as soon as the draft grows past after_length or becomes another message, the message is stored, or the turn ends, or after wait_ms (at most ${MAX_DRAFT_WAIT_MS}).`,
      schema: taskId.extend({
        message_id: z.string().max(200).optional(),
        after_length: z.number().int().nonnegative().default(0),
        wait_ms: z.number().int().min(0).max(MAX_DRAFT_WAIT_MS).default(0),
      }),
      run: async (a) => {
        c.store.get(a.task_id, owner);

        const draft = await c.drafts.wait(
          a.task_id,
          { message_id: a.message_id, length: a.after_length },
          a.wait_ms,
          () => !c.active.has(a.task_id),
        );

        const t = c.store.get(a.task_id, owner);

        return {
          draft: draft ?? null,
          running: ["queued", "starting", "running", "waiting"].includes(
            t.status,
          ),
        };
      },
    }),
    edit_user_agent_queued_message: tool({
      description:
        "User interface only: change a queued message's text before its turn starts.",
      schema: queuedMessage.extend({ message: z.string().min(1).max(20000) }),
      run: (a) => c.editQueued(owner, a.task_id, a.message_id, a.message),
    }),
    move_user_agent_queued_message: tool({
      description:
        "User interface only: move a queued message to a zero-based position in the queue, after any steers the worker already has.",
      schema: queuedMessage.extend({
        index: z.number().int().nonnegative(),
      }),
      run: (a) => c.moveQueued(owner, a.task_id, a.message_id, a.index),
    }),
    remove_user_agent_queued_message: tool({
      description:
        "User interface only: remove a queued message, whoever queued it, before its turn starts.",
      schema: queuedMessage,
      run: (a) => c.removeQueued(owner, a.task_id, a.message_id, "user"),
    }),
    resume_user_agent_queue: tool({
      description:
        "User interface only: resume a task's paused queue; an idle task starts its next queued message.",
      schema: taskId,
      run: (a) => c.resumeQueue(owner, a.task_id),
    }),
    clear_user_agent_queue: tool({
      description: "User interface only: remove every queued message.",
      schema: taskId,
      run: (a) => c.clearQueue(owner, a.task_id),
    }),
    submit_user_agent_input: tool({
      ...tools.submit_agent_input,
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
    update_user_agent_settings: tool({
      ...tools.update_agent_settings,
      description:
        "User interface only: save delegation defaults, including native permission mode and approval decision maker.",
      run: (a) => c.settings.update(owner, a, "user"),
    }),
    get_user_agent_changes: tool({
      ...tools.get_agent_changes,
      description:
        "User interface only: a task's uncommitted changes since it started, for the panel's Changes tab, in the files the task changed (all of a worktree's, for the whole task). Each file is compared with its content at the start, or its committed content if committed since, so earlier uncommitted edits and committed work are left out. Otherwise as get_agent_changes returns them.",
      run: (a) =>
        c.workspaces.uncommittedChanges(
          c.store.get(a.task_id, owner),
          a.scope,
          a.cursor,
        ),
    }),
    get_user_agent_change_counts: tool({
      description:
        "User interface only: a task's uncommitted change totals (file count and line stats) for the panel's tab count and Details, without the file list or diff. Otherwise as get_user_agent_changes counts them.",
      schema: taskId,
      run: (a) => c.workspaces.uncommittedCounts(c.store.get(a.task_id, owner)),
    }),
    get_user_agent_activity: tool({
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
    get_user_agent_turn_activity: tool({
      description:
        "User interface only: one turn's activity for the panel's Activity tab: the events after the previous turn's closing status event through this turn's, or to the newest event while the turn runs. Its newest events come with a tally of the older ones, as get_user_agent_activity gives them.",
      schema: taskId.extend({ turn: z.number().int().positive() }),
      run: (a) => {
        c.store.get(a.task_id, owner);

        return c.activity.turn(a.task_id, a.turn);
      },
    }),
    remove_user_agent_worktree: tool({
      description:
        "User interface only: remove a stopped worktree task's worktree and keep its branch. With uncommitted changes it removes nothing and returns status uncommitted with the files, unless force discards them.",
      schema: taskId.extend({ force: z.boolean().default(false) }),
      run: (a) => c.removeWorktree(owner, a.task_id, a.force),
    }),
    rename_user_agent_task: tool({
      description: "User interface only: change a task's display title.",
      schema: taskId.extend({ title: z.string().trim().min(1).max(200) }),
      run: (a) => c.rename(owner, a.task_id, a.title),
    }),
    delete_user_agent_task: tool({
      description:
        "User interface only: delete a stopped task with its events, requests, worktree and branch. With delete_agent_task it also deletes the provider's session for the task. This can't be undone.",
      schema: taskId.extend({ delete_agent_task: z.boolean().default(false) }),
      run: (a) => c.delete(owner, a.task_id, a.delete_agent_task),
    }),
    delete_user_agent_branch: tool({
      description:
        "User interface only: delete a stopped worktree task's branch once its worktree is removed.",
      schema: taskId,
      run: (a) => c.deleteBranch(owner, a.task_id),
    }),
    get_user_agent_changed_file: tool({
      ...tools.get_agent_changed_file,
      description:
        "User interface only: the content now of a file among a task's uncommitted changes, for the panel's preview, as get_agent_changed_file returns it.",
      run: (a) =>
        c.workspaces.changedFile(
          c.store.get(a.task_id, owner),
          a.path,
          a.cursor,
          undefined,
          true,
        ),
    }),
  };
}

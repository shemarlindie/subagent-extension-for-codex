import { z } from "zod";

import {
  CHAT_EVENTS,
  chatItems,
} from "../../../shared/tasks/conversation/chat.js";
import { MAX_DRAFT_WAIT_MS } from "../../../shared/tasks/conversation/drafts.js";
import {
  conversation,
  MESSAGE_EVENTS,
} from "../../../shared/tasks/conversation/messages.js";
import {
  PARENT_DELEGATION_PROTOCOL,
  PARENT_REPORT_PROTOCOL,
} from "../../../shared/tasks/conversation/parent-protocol.js";
import {
  budgetRaiseSchema,
  deliveries,
  type InputAuthority,
  startSchema,
} from "../../../shared/tasks/model.js";
import { listedTask, replyFrom } from "../../../shared/tasks/task-list.js";
import {
  autoRegisterChatProject,
  currentChatProject,
} from "../../features/projects/chat-project.js";
import { browseProject } from "../../features/projects/project-picker.js";
import {
  settingsReadOutputSchema,
  settingsUpdateOutputSchema,
  settingsUpdateSchema,
} from "../../features/settings/settings.js";
import {
  MAX_MESSAGE_WAIT_SECONDS,
  pollMessages,
} from "../../features/tasks/conversation/message-poll.js";
import {
  acknowledgeParentMessage,
  claimParentMessage,
  recordParentDelivery,
} from "../../features/tasks/conversation/parent-messages.js";
import { Control } from "../../features/tasks/runtime/control.js";
import {
  panelContextInput,
  resolvePanelContext,
} from "../panel/panel-context.js";
import {
  mentionSearchSchema,
  mentionSearchToolName,
  searchAgentMentions,
} from "./mentions.js";

const taskId = z.object({ task_id: z.string() });

const queuedMessage = taskId.extend({ message_id: z.string().max(200) });

const messageInput = taskId.extend({
  message: z.string().min(1).max(20000),
  delivery: z
    .enum(deliveries)
    .default("steer")
    .describe(
      "steer (default): a running turn takes it at its next tool boundary, without stopping. queue: it waits and starts a turn of its own after the current one. interrupt: stop the running turn and start the next one with this message and any pending steers. On an idle task, each starts the next turn. A task waiting for input can't be steered; answer it with submit_agent_input, or queue the message.",
    ),
  budget: budgetRaiseSchema
    .optional()
    .describe(
      "Raise the task's budget first, so a turn stopped by its budget can carry on. Each limit can only go up: a higher amount, or null for no limit.",
    ),
});

/**
 * A tool whose handler receives its schema's parsed output. `run` uses method
 * syntax so any tool widens to `AnyTool` for name-based dispatch.
 */
type Tool<S extends z.ZodType, R> = {
  description: string;
  schema: S;
  outputSchema?: z.ZodType;
  run(args: z.output<S>): R;
};

export type AnyTool = Tool<z.ZodType<Record<string, unknown>>, unknown>;
const tool = <S extends z.ZodType, R>(definition: Tool<S, R>) => definition;

/** Optional host conversation correlation is a UI scope, never an access grant. */
export function withConversation(
  name: string,
  args: Record<string, unknown>,
  meta?: Record<string, unknown>,
) {
  if (
    ["open_codex_subagent_extension", "get_agent_panel_context"].includes(
      name,
    ) &&
    args.conversation_id !== null &&
    args.task_id === undefined &&
    args.host_directory === undefined
  ) {
    const state = meta?.["codex/sandbox-state-meta"] as
      { sandboxCwd?: unknown } | undefined;

    if (
      typeof state?.sandboxCwd === "string" &&
      state.sandboxCwd.length <= 4096
    ) {
      args = { ...args, host_directory: state.sandboxCwd };
    }
  }

  // A selected task supplies its own scope; ambient chat hints cannot constrain it.
  if (
    ![
      "open_codex_subagent_extension",
      "start_agent_task",
      "start_user_agent_task",
      "list_agent_tasks",
      "get_agent_panel_context",
    ].includes(name) ||
    args.conversation_id !== undefined ||
    (["open_codex_subagent_extension", "get_agent_panel_context"].includes(
      name,
    ) &&
      args.task_id !== undefined)
  ) {
    return args;
  }

  // Codex core adds threadId; ChatGPT documents its anonymized session field.
  // Both are optional correlation hints, never filesystem/ownership authority.
  const session = meta?.["openai/session"] ?? meta?.threadId;

  return typeof session === "string" && session.trim() && session.length <= 256
    ? { ...args, conversation_id: session }
    : args;
}

export function definitions(
  c: Control,
  owner: string,
  authority: InputAuthority = "parent",
  hostMeta?: Record<string, unknown>,
) {
  const tools = {
    get_agent_panel_context: tool({
      description:
        "Resolve panel repository/revision defaults from explicit approved context or the latest task in this conversation. task_id selects an owned task. null conversation_id explicitly requests all conversations. This never registers a project or starts work; for a returned panel_project_candidate, ask the user to use Add project in the panel.",
      schema: panelContextInput,
      run: (a) => resolvePanelContext(c, owner, a),
    }),
    list_agent_projects: tool({
      description:
        "List persistently approved project roots. Never registers. Pass an explicit absolute repository to start_agent_task. If the chat's project is missing, ask the user to use Add project in the panel. Task arguments never grant access.",
      schema: z.strictObject({}),
      run: () => c.projects?.list() ?? [],
    }),
    get_current_agent_project: tool({
      description:
        "Resolve the current chat's local Git root from host directory metadata and report whether it is registered. Never registers. When it is unregistered, follow next_step: starting a task for it from this chat adds it if auto_register_on_task_start is true; otherwise ask the user to use Add project in the panel. Tool arguments cannot grant directory access.",
      schema: z.strictObject({}),
      run: () => currentChatProject(c, owner, hostMeta),
    }),
    get_agent_settings: tool({
      description: "Read persistent user defaults for delegation and budgets.",
      schema: z.strictObject({}),
      outputSchema: settingsReadOutputSchema,
      run: async () => c.settings.read(owner, await c.availableWorkers()),
    }),
    update_agent_settings: tool({
      description:
        "Update non-approval user defaults. Project auto-registration, native permission mode, and approval decision maker changes require the user settings interface. Omitted fields and existing tasks stay unchanged.",
      schema: settingsUpdateSchema,
      outputSchema: settingsUpdateOutputSchema,
      run: (a) => c.settings.update(owner, a, authority),
    }),
    start_agent_task: tool({
      description:
        "Create durable asynchronous work from the full request in description; a concise title is generated automatically. Work starts in the current repository by default, including uncommitted changes, or in a committed-revision worktree when requested. Supply an explicit absolute repository from list_agent_projects; current does not identify the host chat project. Reopen existing work with open_codex_subagent_extension(task_id), never another start call.",
      schema: startSchema.extend({
        conversation_id: startSchema.shape.conversation_id.nullable(),
        provider: startSchema.shape.provider.unwrap().optional(),
        worker_profile: startSchema.shape.worker_profile.unwrap().optional(),
        workspace_strategy: startSchema.shape.workspace_strategy
          .unwrap()
          .optional(),
        budget: startSchema.shape.budget
          .unwrap()
          .extend({
            max_runtime_minutes: startSchema.shape.budget
              .unwrap()
              .shape.max_runtime_minutes.unwrap()
              .optional(),
            max_cost_usd: startSchema.shape.budget
              .unwrap()
              .shape.max_cost_usd.unwrap()
              .optional(),
          })
          .optional(),
      }),
      // Null opts out of host correlation; persisted tasks keep the optional string contract.
      run: async (a) => {
        await autoRegisterChatProject(c, owner, hostMeta, a.repository);

        return c.start(
          owner,
          { ...a, conversation_id: a.conversation_id ?? undefined },
          authority,
        );
      },
    }),
    get_agent_task: tool({
      description:
        "Inspect a task: its draft (the message the worker is writing, if any), its status and turn (the number of turns started), pending input, pending steers (sent into the running turn and not yet taken), queue (messages waiting for turns of their own, and whether an interrupt paused it) and an excerpt of its latest reply.",
      schema: taskId,
      run: (a) => {
        const t = c.store.get(a.task_id, owner);

        const draft = c.drafts.get(t.id);

        return {
          ...t,
          reply: replyFrom(c.store.latestEvent(t.id, "agent.reply")) ?? null,
          ...(draft ? { draft } : {}),
        };
      },
    }),
    list_agent_tasks: tool({
      description:
        "List owned tasks, optionally scoped to a conversation and repository. Each includes an excerpt of its latest reply and its number of queued messages. null conversation_id explicitly requests all conversations.",
      schema: z.object({
        conversation_id: z.string().nullable().optional(),
        repository: z.string().optional(),
      }),
      run: (a) =>
        c.store
          .all(owner)
          .filter(
            (t) =>
              (!a.conversation_id || t.conversation_id === a.conversation_id) &&
              (!a.repository || t.repository === a.repository),
          )
          .map((t) =>
            listedTask(
              t,
              t.status === "running" ? c.store.recentEvents(t.id, owner) : [],
              c.store.latestEvent(t.id, "agent.reply"),
              c.drafts.get(t.id),
            ),
          ),
    }),
    list_available_workers: tool({
      description:
        "Discover installed providers, profiles, supported capabilities, and whether each provider's runtime is ready to start tasks.",
      schema: z.object({}),
      run: () => c.availableWorkers(),
    }),
    [mentionSearchToolName]: tool({
      description:
        "Search for the configured Claude provider in the composer mention picker.",
      schema: mentionSearchSchema,
      run: ({ query }) => searchAgentMentions(query, c.workers()),
    }),
    interrupt_agent_task: tool({
      description:
        "Stop the task's running turn, keeping its session and workspace. Steers it hasn't taken wait at the front of its queue, which pauses until the next message is sent. send_pending (interrupt and send now) instead starts the next turn at once with the pending steers.",
      schema: taskId.extend({ send_pending: z.boolean().default(false) }),
      run: (a) => c.interrupt(owner, a.task_id, a.send_pending),
    }),
    send_agent_message: tool({
      description:
        "Send a message to a task's worker, as in a conversation. An idle task (completed, failed or interrupted) starts its next turn: it resumes the worker's session, or starts a new one carrying the conversation, and recreates a removed worktree. While a turn runs, delivery chooses how the message reaches it. Returns the message's id and state: started (it starts or joins the next turn), pending_steer (the running turn takes it at its next tool boundary) or queued. Read replies with get_agent_messages.",
      schema: messageInput,
      run: async (a) => {
        const sent = await c.send(owner, a.task_id, a.message, authority, {
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
    remove_agent_queued_message: tool({
      description:
        "Withdraw a message you queued before its turn starts. Messages the user queued stay.",
      schema: queuedMessage,
      run: (a) => c.removeQueued(owner, a.task_id, a.message_id, "parent"),
    }),
    submit_agent_input: tool({
      description:
        "Respond to a pending question, or decide execution permission when provider_options.claude.approval_decider is parent_agent for Claude (or approval_mode is parent_agent for execution-approval providers). Ask-user permissions require the panel approval buttons. Request ID prevents stale approvals.",
      schema: taskId.extend({
        request_id: z.string(),
        approved: z.boolean(),
        input: z.record(z.string(), z.unknown()).optional(),
        message: z.string().max(20000).optional(),
      }),
      run: (a) =>
        c.input(
          owner,
          a.task_id,
          a.request_id,
          a.approved,
          a.input,
          a.message,
          authority,
        ),
    }),
    get_agent_messages: tool({
      description: `Read a task's conversation after a cursor: its request, the messages you and the user sent, the worker's messages, and each successful turn's reply (kind reply, the text that ended the turn). Pass next_cursor back as after to read only what follows. With wait_seconds (at most ${MAX_MESSAGE_WAIT_SECONDS}), it waits until a message follows the cursor, the turn ends or input is needed. Only complete messages are returned; a read that waits out its time includes draft, the text of the message being written. Also returns the task's status, turn, whether a turn is still running, any pending_input and its number of queued messages. Read what a turn changed with get_agent_changes(scope: "turn"). ${PARENT_DELEGATION_PROTOCOL}`,
      schema: taskId.extend({
        after: z.number().int().nonnegative().default(0),
        wait_seconds: z
          .number()
          .min(0)
          .max(MAX_MESSAGE_WAIT_SECONDS)
          .default(0),
      }),
      run: (a) =>
        pollMessages(
          c.store,
          c.drafts,
          owner,
          a.task_id,
          a.after,
          a.wait_seconds,
        ),
    }),
    get_agent_message: tool({
      description: `Retrieve one stored conversation message by task ID and stable message ID, independently of the polling cursor. ${PARENT_REPORT_PROTOCOL}`,
      schema: taskId.extend({ message_id: z.string().min(1) }),
      run: (a) => {
        const task = c.store.get(a.task_id, owner);

        const message = conversation(
          task,
          c.store.eventsOfTypes(task.id, MESSAGE_EVENTS),
        ).find((m) => m.id === a.message_id);

        if (!message) throw new Error("Message not found");

        return { message };
      },
    }),
    ack_agent_message: tool({
      description:
        "Durably acknowledge an immutable explicit worker report (parent_message: true) after you successfully process it. Reading alone is not acknowledgement. Pass the report's task ID and stable message ID; repeat calls are idempotent. Normal worker text and final replies cannot be acknowledged with this tool. Acknowledged reports stay retrievable, with acknowledged: true, and will not be newly claimed for host notification.",
      schema: taskId.extend({ message_id: z.string().min(1) }),
      run: (a) =>
        acknowledgeParentMessage(c.store, owner, a.task_id, a.message_id),
    }),
    get_agent_changes: tool({
      description:
        "Read what a task changed, live from Git: a unified diff with per-file stats, for the whole task (default) or its latest turn. Worktree tasks diff their base commit against the worktree now. current_repo tasks diff a snapshot from task start against a snapshot from when the worker last stopped (its latest turn ended, or it began waiting for input), or the checkout now while it runs, so edits by anyone in that checkout in between are included. Every page lists every file; large diffs come in pages of whole files, so pass next_cursor back to read the rest. state workspace_missing means the worktree was removed, so the changes are those committed on branch; branch_deleted means the branch is gone too; end_unrecorded means a current_repo task ended before its end state was recorded, so its changes can't be separated from later edits.",
      schema: taskId.extend({
        scope: z.enum(["task", "turn"]).default("task"),
        cursor: z.string().max(300).optional(),
      }),
      run: (a) =>
        c.workspaces.changes(c.store.get(a.task_id, owner), a.scope, a.cursor),
    }),
    get_agent_changed_file: tool({
      description:
        "Read one file a task changed, where get_agent_changes ends: its worktree now (or, once removed, its branch), or a current_repo checkout as the worker last left it. path must be listed by get_agent_changes (the whole task or its latest turn). state is deleted when the change removed the file, or binary with only its size for non-image binary files; images come as base64. Large files come in parts: pass next_cursor back to read the rest.",
      schema: taskId.extend({
        path: z.string().min(1).max(4096),
        cursor: z.string().max(300).optional(),
      }),
      run: (a) =>
        c.workspaces.changedFile(
          c.store.get(a.task_id, owner),
          a.path,
          a.cursor,
        ),
    }),
    get_agent_events: tool({
      description:
        "Retrieve the full ordered execution log after an optional cursor: tool calls, worker messages and lifecycle events. For the conversation, use get_agent_messages.",
      schema: taskId.extend({
        after: z.number().int().nonnegative().default(0),
      }),
      run: (a) => c.store.events(a.task_id, owner, a.after),
    }),
  };

  return {
    ...tools,
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

export const isUserTool = (name: string) =>
  [
    "register_user_agent_project",
    "rename_user_agent_project",
    "remove_user_agent_project",
    "browse_user_agent_project",
    "start_user_agent_task",
    "submit_user_agent_input",
    "send_user_agent_message",
    "raise_user_agent_budget",
    "claim_user_agent_parent_message",
    "record_user_agent_parent_delivery",
    "get_user_agent_chat",
    "get_user_agent_draft",
    "edit_user_agent_queued_message",
    "move_user_agent_queued_message",
    "remove_user_agent_queued_message",
    "resume_user_agent_queue",
    "clear_user_agent_queue",
    "update_user_agent_settings",
    "get_user_agent_changes",
    "get_user_agent_change_counts",
    "get_user_agent_changed_file",
    "get_user_agent_activity",
    "get_user_agent_turn_activity",
    "remove_user_agent_worktree",
    "rename_user_agent_task",
    "delete_user_agent_task",
    "delete_user_agent_branch",
  ].includes(name);

export async function callTool(
  c: Control,
  owner: string,
  name: string,
  args: unknown,
  authority: InputAuthority = "parent",
  hostMeta?: Record<string, unknown>,
) {
  if (isUserTool(name) && authority !== "user") {
    throw new Error("User tools require a user interface");
  }

  const defs = definitions(c, owner, authority, hostMeta);
  if (!(name in defs)) throw new Error("Unknown tool");
  const d: AnyTool = defs[name as keyof typeof defs];

  return d.run(d.schema.parse(args ?? {}));
}

import { z } from "zod";

import {
  conversation,
  MESSAGE_EVENTS,
} from "../../../../shared/tasks/conversation/messages.js";
import {
  PARENT_DELEGATION_PROTOCOL,
  PARENT_REPORT_PROTOCOL,
} from "../../../../shared/tasks/conversation/parent-protocol.js";
import { startSchema } from "../../../../shared/tasks/model.js";
import { listedTask, replyFrom } from "../../../../shared/tasks/task-list.js";
import {
  autoRegisterChatProject,
  currentChatProject,
} from "../../../features/projects/chat-project.js";
import {
  settingsReadOutputSchema,
  settingsUpdateOutputSchema,
  settingsUpdateSchema,
} from "../../../features/settings/settings-values.js";
import {
  MAX_MESSAGE_WAIT_SECONDS,
  pollMessages,
} from "../../../features/tasks/conversation/message-poll.js";
import { acknowledgeParentMessage } from "../../../features/tasks/conversation/parent-messages.js";
import {
  panelContextInput,
  resolvePanelContext,
} from "../../panel/panel-context.js";
import {
  mentionSearchSchema,
  mentionSearchToolName,
  searchAgentMentions,
} from "../mentions.js";
import {
  messageInput,
  queuedMessage,
  taskId,
  tool,
  type ToolContext,
} from "./definition.js";

/** Tools the parent agent calls; the panel uses some of them too. */
export function agentTools({ c, owner, authority, hostMeta }: ToolContext) {
  return {
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
        "List owned tasks, optionally scoped to a conversation and repository. Each includes an excerpt of its latest reply, its number of queued messages and unread: true when the user hasn't viewed its latest reply, outcome or request in the panel, with read_through, the newest event they had read. null conversation_id explicitly requests all conversations.",
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
              c.store.readState(t.id),
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
        "Read what a task changed, live from Git: a unified diff with per-file stats, for the whole task (default) or its latest turn. Worktree tasks diff their base commit against the worktree now. current_repo tasks diff a snapshot from task start against a snapshot from when the worker last stopped (its latest turn ended, or it began waiting for input), or the checkout now while it runs, limited to files changed while its turns ran (not between turns or while it waited for input); other edits to those files are included. Every page lists every file; large diffs come in pages of whole files, so pass next_cursor back to read the rest. state workspace_missing means the worktree was removed, so the changes are those committed on branch; branch_deleted means the branch is gone too; end_unrecorded means a current_repo task ended before its end state was recorded, so its changes can't be separated from later edits.",
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
}

import { z } from "zod";

import {
  conversation,
  MESSAGE_EVENTS,
} from "../../../../shared/tasks/conversation/messages.js";
import { PARENT_SUPERVISION_PROTOCOL } from "../../../../shared/tasks/conversation/parent-protocol.js";
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
} from "../../../features/settings/settings-tool-schemas.js";
import {
  MAX_MESSAGE_WAIT_SECONDS,
  pollMessages,
} from "../../../features/tasks/conversation/message-poll.js";
import {
  panelContextInput,
  resolvePanelContext,
} from "../../panel/panel-context.js";
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
    get_panel_context: tool({
      readOnly: true,
      conversation: "panel",
      description:
        "Resolve panel defaults for repository, revision and conversation from explicit arguments, host_directory or this conversation's latest task. task_id selects an owned task. null conversation_id means all conversations. Never registers a project or starts work. For a returned panel_project_candidate, ask the user to use Add project in the panel.",
      schema: panelContextInput,
      run: (a) => resolvePanelContext(c, owner, a),
    }),
    list_projects: tool({
      readOnly: true,
      description:
        "List registered project roots. Pass one to start_task as the explicit absolute repository. Never registers. If the chat's project is missing, ask the user to use Add project in the panel.",
      schema: z.strictObject({}),
      run: () => c.projects?.list() ?? [],
    }),
    get_current_project: tool({
      readOnly: true,
      description:
        "Find the current chat's local Git root from host directory metadata and report whether it is registered. Never registers. For an unregistered project, follow next_step.",
      schema: z.strictObject({}),
      run: () => currentChatProject(c, owner, hostMeta),
    }),
    get_settings: tool({
      readOnly: true,
      description:
        "Read the user's delegation defaults and budgets. The schema marks user-only groups with userOnly: true.",
      schema: z.strictObject({}),
      outputSchema: settingsReadOutputSchema,
      run: async () => c.settings.read(owner, await c.availableWorkers(owner)),
    }),
    update_settings: tool({
      description:
        "Change task and model defaults with a nested partial of get_settings values. Groups marked userOnly (profiles, approvals, projects and providers) need the user's settings panel. Omitted settings and existing tasks stay unchanged.",
      schema: settingsUpdateSchema,
      outputSchema: settingsUpdateOutputSchema,
      run: (a) => c.settings.update(owner, a, authority),
    }),
    start_task: tool({
      openWorld: true,
      panel: true,
      conversation: "chat",
      description:
        "Start asynchronous work on the full request in description. The service generates the title. Work runs in the current checkout by default, including uncommitted changes. Reopen existing work with open_subagent_extension_for_codex(task_id), never another start_task.",
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
    get_task: tool({
      readOnly: true,
      description:
        "Read a task's full state: status, turn (the number of turns started), pending input, draft (the message being written), pending steers not yet taken, queue (messages waiting for their own turn, and whether an interrupt paused it), branch for worktree tasks and an excerpt of the latest reply.",
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
    list_tasks: tool({
      readOnly: true,
      conversation: "chat",
      description:
        "List your tasks, optionally filtered by conversation and repository. null conversation_id means all conversations. Each task includes an excerpt of its latest reply, its queued message count, unread: true when the user hasn't seen its latest update in the panel, read_through (the newest event they read) and archived_at when archived.",
      schema: z.object({
        conversation_id: z.string().nullable().optional(),
        repository: z.string().optional(),
      }),
      run: (a) => {
        const archived = c.archive.times(owner);

        return c.store
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
              archived.get(t.id),
            ),
          );
      },
    }),
    list_workers: tool({
      readOnly: true,
      description:
        "List installed providers with their profiles, capabilities and readiness. When readiness.ready is false, report readiness.message to the user instead of retrying.",
      schema: z.object({}),
      run: () => c.availableWorkers(owner),
    }),
    interrupt_task: tool({
      description:
        "Stop the running turn and keep the session and workspace. Steers the turn hasn't taken move to the front of the queue, which stays paused until the next message. send_pending starts the next turn now with those steers.",
      schema: taskId.extend({ send_pending: z.boolean().default(false) }),
      run: (a) => c.interrupt(owner, a.task_id, a.send_pending),
    }),
    send_message: tool({
      description:
        "Send the worker a message. On an idle task (completed, failed or interrupted) it starts the next turn, resuming the session or starting a new one that carries the conversation, and recreates a removed worktree. While a turn runs, delivery decides how the message arrives. Returns message_id and state: started, pending_steer or queued. Read replies with list_messages.",
      schema: messageInput,
      run: async (a) => {
        const sent = await c.send(owner, a.task_id, a.message, authority, {
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
    remove_queued_message: tool({
      description:
        "Withdraw a message you queued before its turn starts. Messages the user queued stay.",
      schema: queuedMessage,
      run: (a) => c.removeQueued(owner, a.task_id, a.message_id, "parent"),
    }),
    submit_input: tool({
      description:
        "Answer pending_input with its exact request_id. Answer questions directly. Decide a permission only when it is routed to you: provider_options.claude.approval_decider is parent_agent for Claude, or approval_mode is parent_agent for other providers. Judge it against the scope the user authorized. For permissions routed to the user, show the request and direct the user to the panel's Approve or Deny buttons.",
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
    list_messages: tool({
      readOnly: true,
      description: `Read a task's conversation after a cursor: the request, messages from you and the user, worker messages and each successful turn's reply (kind reply). Pass next_cursor back as after. With wait_seconds (at most ${MAX_MESSAGE_WAIT_SECONDS}), it waits for a new message, the end of the turn or an input request. A wait that times out includes draft, the message being written. Also returns status, turn, running, pending_input and queued_messages, the queued message count. Read what a turn changed with get_changes(scope: "turn"). ${PARENT_SUPERVISION_PROTOCOL}`,
      schema: taskId.extend({
        after: z.number().int().nonnegative().default(0),
        wait_seconds: z
          .number()
          .min(0)
          .max(MAX_MESSAGE_WAIT_SECONDS)
          .default(0),
      }),
      run: async (a) => {
        const result = await pollMessages(
          c.store,
          c.drafts,
          owner,
          a.task_id,
          a.after,
          a.wait_seconds,
        );

        // The parent has now seen the updates this read covered.
        c.parentSeen.markRange(owner, a.task_id, a.after, result.next_cursor);

        return result;
      },
    }),
    get_message: tool({
      readOnly: true,
      description:
        "Read one conversation message by task and message ID, independent of the polling cursor.",
      schema: taskId.extend({ message_id: z.string().min(1) }),
      run: (a) => {
        const task = c.store.get(a.task_id, owner);

        const message = conversation(
          task,
          c.store.eventsOfTypes(task.id, MESSAGE_EVENTS),
        ).find((m) => m.id === a.message_id);

        if (!message) throw new Error("Message not found");

        if (message.kind === "reply") {
          c.parentSeen.markEvents(owner, [message.event_id]);
        }

        return { message };
      },
    }),
    get_changes: tool({
      readOnly: true,
      description:
        "Read the worker's recorded edits for the whole task or the latest turn as a unified diff with per-file stats. Prefer this to the worker's own account of its changes. Every page lists every file. Pass next_cursor to read more diffs. Incomplete files have no diff, and unrecorded_commands means a command changed files without recorded edits. Inspect those files directly. Commits and worktree removal leave these diffs unchanged. Worktree commits are on task.branch.",
      schema: taskId.extend({
        scope: z.enum(["task", "turn"]).default("task"),
        cursor: z.string().max(300).optional(),
      }),
      run: (a) =>
        c.changes.changes(c.store.get(a.task_id, owner), a.scope, a.cursor),
    }),
    get_changed_file: tool({
      readOnly: true,
      description:
        "Read a changed file's current content on disk, including later edits by anyone. path must appear in the task or latest-turn changes. state is deleted for a missing file, unavailable for a removed workspace, or binary with its size for other binary files. Images are base64. Pass next_cursor for more content.",
      schema: taskId.extend({
        path: z.string().min(1).max(4096),
        cursor: z.string().max(300).optional(),
      }),
      run: (a) =>
        c.changes.changedFile(c.store.get(a.task_id, owner), a.path, a.cursor),
    }),
    list_events: tool({
      readOnly: true,
      description:
        "Read the full ordered execution log after an optional cursor: tool calls, worker messages and lifecycle events. For the conversation, use list_messages.",
      schema: taskId.extend({
        after: z.number().int().nonnegative().default(0),
      }),
      run: (a) => c.store.events(a.task_id, owner, a.after),
    }),
  };
}

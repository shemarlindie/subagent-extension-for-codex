import { z } from "zod";

import {
  autoRegisterChatProject,
  currentChatProject,
} from "../core/chat-project.js";
import { Control } from "../core/control.js";
import { type InputAuthority, startSchema } from "../core/model.js";
import { browseProject } from "../core/project-picker.js";
import {
  settingsReadOutputSchema,
  settingsUpdateOutputSchema,
  settingsUpdateSchema,
} from "../core/settings.js";
import { listedTask } from "../core/task-list.js";
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
    )
      args = { ...args, host_directory: state.sandboxCwd };
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
  )
    return args;
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
        "Resolve panel repository/revision defaults from explicit approved context or the latest task in this conversation. task_id selects an owned task. null conversation_id explicitly requests all conversations. This never registers a project or starts work; for a returned panel_project_candidate, ask the user whether to add it with request_agent_project.",
      schema: panelContextInput,
      run: (a) => resolvePanelContext(c, owner, a),
    }),
    list_agent_projects: tool({
      description:
        "List persistently approved project roots. Never registers. Pass an explicit absolute repository to start_agent_task. If the chat's project is missing, ask the user whether to add it by calling request_agent_project. Task arguments never grant access.",
      schema: z.strictObject({}),
      run: () =>
        c.projects?.list() ?? [
          { repository: c.repository, name: c.repository, kind: "repository" },
        ],
    }),
    get_current_agent_project: tool({
      description:
        "Resolve the current chat's local Git root from host directory metadata and report whether it is registered. Never registers. When it is unregistered, follow next_step: starting a task for it from this chat adds it if auto_register_on_task_start is true; otherwise ask the user with request_agent_project. Tool arguments cannot grant directory access.",
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
        "Create durable asynchronous work from the full request in description; a concise title is generated automatically when omitted. Work starts in the current repository by default, including uncommitted changes, or in a committed-revision worktree when requested. Supply an explicit absolute repository from list_agent_projects; current does not identify the host chat project. Reopen existing work with open_codex_subagent_extension(task_id), never another start call.",
      schema: startSchema.extend({
        conversation_id: startSchema.shape.conversation_id.nullable(),
        provider: startSchema.shape.provider.removeDefault().optional(),
        worker_profile: startSchema.shape.worker_profile
          .removeDefault()
          .optional(),
        workspace_strategy: startSchema.shape.workspace_strategy
          .removeDefault()
          .optional(),
        budget: startSchema.shape.budget
          .removeDefault()
          .extend({
            max_runtime_minutes: startSchema.shape.budget
              .removeDefault()
              .shape.max_runtime_minutes.removeDefault()
              .optional(),
            max_cost_usd: startSchema.shape.budget
              .removeDefault()
              .shape.max_cost_usd.removeDefault()
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
      description: "Inspect task state and pending input.",
      schema: taskId,
      run: (a) => c.store.get(a.task_id, owner),
    }),
    list_agent_tasks: tool({
      description:
        "List owned tasks, optionally scoped to a conversation and repository. null conversation_id explicitly requests all conversations.",
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
            ),
          ),
    }),
    list_available_workers: tool({
      description:
        "Discover installed providers, profiles, and supported capabilities.",
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
        "Stop current execution while preserving the session and workspace.",
      schema: taskId,
      run: (a) => c.stop(owner, a.task_id, "interrupted"),
    }),
    continue_agent_task: tool({
      description:
        "Continue an interrupted task on the worker owning its session state.",
      schema: taskId.extend({ message: z.string().max(20000).optional() }),
      run: (a) => c.continue(owner, a.task_id, a.message),
    }),
    send_agent_instruction: tool({
      description:
        "Steer a task. Running turns are interrupted and continued with this instruction.",
      schema: taskId.extend({ message: z.string().min(1).max(20000) }),
      run: (a) => c.steer(owner, a.task_id, a.message),
    }),
    cancel_agent_task: tool({
      description: "Cancel a task. Does not delete its workspace or artifacts.",
      schema: taskId,
      run: (a) => c.stop(owner, a.task_id, "cancelled"),
    }),
    retry_agent_task: tool({
      description: "Create a new attempt from a failed or cancelled task.",
      schema: taskId,
      run: (a) => c.retry(owner, a.task_id),
    }),
    submit_agent_input: tool({
      description:
        "Respond to a pending question, or decide execution permission when approval_decider is parent_agent for Claude (or approval_mode is parent_agent for legacy workers). Ask-user permissions require user buttons or request_agent_input. Request ID prevents stale approvals.",
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
    get_agent_result: tool({
      description: "Retrieve structured results when available.",
      schema: taskId,
      run: (a) => ({
        result: c.store.get(a.task_id, owner).result ?? null,
      }),
    }),
    get_agent_artifacts: tool({
      description:
        "Retrieve report and diff artifacts without applying them to the primary workspace.",
      schema: taskId,
      run: (a) => c.store.artifacts(a.task_id, owner),
    }),
    get_agent_events: tool({
      description:
        "Retrieve ordered execution events after an optional cursor.",
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
        if (!c.projects)
          throw new Error(
            "Project registration is unavailable in this service.",
          );

        return c.projects.register(a.repository);
      },
    }),
    browse_user_agent_project: tool({
      description:
        "User interface only: open a native folder picker on the local macOS service host. Returns a path or null on cancellation; never registers a project.",
      schema: z.strictObject({}),
      run: () => browseProject(),
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
    // App-only so image thumbnails and snippets never enter model context.
    list_user_agent_artifacts: tool({
      description:
        "User interface only: list a task's artifacts as file summaries (name, size, snippet or thumbnail) without their content.",
      schema: taskId,
      run: (a) => c.store.artifactSummaries(a.task_id, owner),
    }),
    get_user_agent_artifact: tool({
      description:
        "User interface only: retrieve one artifact with its content for preview or download.",
      schema: taskId.extend({ artifact_id: z.string() }),
      run: (a) => c.store.artifactById(a.task_id, a.artifact_id, owner),
    }),
  };
}

export const isUserTool = (name: string) =>
  [
    "register_user_agent_project",
    "browse_user_agent_project",
    "start_user_agent_task",
    "submit_user_agent_input",
    "update_user_agent_settings",
    "list_user_agent_artifacts",
    "get_user_agent_artifact",
  ].includes(name);

export async function callTool(
  c: Control,
  owner: string,
  name: string,
  args: unknown,
  authority: InputAuthority = "parent",
  hostMeta?: Record<string, unknown>,
) {
  if (isUserTool(name) && authority !== "user")
    throw new Error("User tools require a user interface");
  const defs = definitions(c, owner, authority, hostMeta);
  if (!(name in defs)) throw new Error("Unknown tool");
  const d: AnyTool = defs[name as keyof typeof defs];

  return d.run(d.schema.parse(args ?? {}));
}

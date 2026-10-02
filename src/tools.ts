import { z } from "zod";
import { Control } from "./control.js";
import { startSchema } from "./model.js";
import { panelContextInput, resolvePanelContext } from "./panel-context.js";
import {
  settingsUpdateSchema,
  settingsReadOutputSchema,
  settingsUpdateOutputSchema,
} from "./settings.js";
const taskId = z.object({ task_id: z.string() });
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
export function definitions(c: Control, owner: string) {
  return {
    get_agent_panel_context: {
      description:
        "Resolve panel repository/revision defaults from explicit approved context or the latest task in this conversation. task_id selects an owned task. null conversation_id explicitly requests all conversations. This never registers a project or starts work.",
      schema: panelContextInput,
      run: (a: any) => resolvePanelContext(c, owner, a),
    },
    list_agent_projects: {
      description:
        "List persistently approved project roots. Pass an explicit absolute repository to start_agent_task. Register missing roots with the local projects CLI, never by a task argument.",
      schema: z.strictObject({}),
      run: () =>
        c.projects?.list() ?? [
          { repository: c.repository, name: c.repository, kind: "repository" },
        ],
    },
    get_agent_settings: {
      description: "Read persistent user defaults for delegation and budgets.",
      schema: z.strictObject({}),
      outputSchema: settingsReadOutputSchema,
      run: () => c.settings.read(owner),
    },
    update_agent_settings: {
      description:
        "Update user defaults. Omitted fields and existing tasks stay unchanged.",
      schema: settingsUpdateSchema,
      outputSchema: settingsUpdateOutputSchema,
      run: (a: any) => c.settings.update(owner, a),
    },
    start_agent_task: {
      description:
        "Create durable asynchronous work in an isolated Git worktree and open its Activity panel when the host supports MCP Apps. Supply an explicit absolute repository from list_agent_projects; current does not identify the host chat project. Reopen existing work with open_codex_subagent_extension(task_id), never another start call.",
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
      run: (a: any) =>
        c.start(owner, {
          ...a,
          conversation_id: a.conversation_id ?? undefined,
        }),
    },
    get_agent_task: {
      description: "Inspect task state and pending input.",
      schema: taskId,
      run: (a: any) => c.store.get(a.task_id, owner),
    },
    list_agent_tasks: {
      description:
        "List owned tasks, optionally scoped to a conversation and repository. null conversation_id explicitly requests all conversations.",
      schema: z.object({
        conversation_id: z.string().nullable().optional(),
        repository: z.string().optional(),
      }),
      run: (a: any) =>
        c.store
          .all(owner)
          .filter(
            (t) =>
              (!a.conversation_id || t.conversation_id === a.conversation_id) &&
              (!a.repository || t.repository === a.repository),
          ),
    },
    list_available_workers: {
      description:
        "Discover installed providers, profiles, and supported capabilities.",
      schema: z.object({}),
      run: () => c.workers(),
    },
    interrupt_agent_task: {
      description:
        "Stop current execution while preserving the session and workspace.",
      schema: taskId,
      run: (a: any) => c.stop(owner, a.task_id, "interrupted"),
    },
    continue_agent_task: {
      description:
        "Continue an interrupted task on the worker owning its session state.",
      schema: taskId.extend({ message: z.string().max(20000).optional() }),
      run: (a: any) => c.continue(owner, a.task_id, a.message),
    },
    send_agent_instruction: {
      description:
        "Steer a task. Running turns are interrupted and continued with this instruction.",
      schema: taskId.extend({ message: z.string().min(1).max(20000) }),
      run: (a: any) => c.steer(owner, a.task_id, a.message),
    },
    cancel_agent_task: {
      description: "Cancel a task. Does not delete its workspace or artifacts.",
      schema: taskId,
      run: (a: any) => c.stop(owner, a.task_id, "cancelled"),
    },
    retry_agent_task: {
      description: "Create a new attempt from a failed or cancelled task.",
      schema: taskId,
      run: (a: any) => c.retry(owner, a.task_id),
    },
    submit_agent_input: {
      description:
        "Respond to a specific pending permission or question. Request ID prevents stale approvals.",
      schema: taskId.extend({
        request_id: z.string(),
        approved: z.boolean(),
        input: z.record(z.string(), z.unknown()).optional(),
        message: z.string().max(20000).optional(),
      }),
      run: (a: any) =>
        c.input(owner, a.task_id, a.request_id, a.approved, a.input, a.message),
    },
    get_agent_result: {
      description: "Retrieve structured results when available.",
      schema: taskId,
      run: (a: any) => ({
        result: c.store.get(a.task_id, owner).result ?? null,
      }),
    },
    get_agent_artifacts: {
      description:
        "Retrieve report and diff artifacts without applying them to the primary workspace.",
      schema: taskId,
      run: (a: any) => c.store.artifacts(a.task_id, owner),
    },
    get_agent_events: {
      description:
        "Retrieve ordered execution events after an optional cursor.",
      schema: taskId.extend({
        after: z.number().int().nonnegative().default(0),
      }),
      run: (a: any) => c.store.events(a.task_id, owner, a.after),
    },
  };
}
export async function callTool(
  c: Control,
  owner: string,
  name: string,
  args: unknown,
) {
  const defs = definitions(c, owner);
  if (!(name in defs)) throw new Error("Unknown tool");
  const d = defs[name as keyof typeof defs];
  return d.run(d.schema.parse(args ?? {}) as any);
}

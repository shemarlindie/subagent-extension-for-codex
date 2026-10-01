import { z } from "zod";
import { Control } from "./control.js";
import { startSchema } from "./model.js";
import { settingsUpdateSchema } from "./settings.js";
const taskId = z.object({ task_id: z.string() });
export function definitions(c: Control, owner: string) {
  return {
    get_agent_settings: {
      description: "Read persistent user defaults for delegation and budgets.",
      schema: z.strictObject({}),
      run: () => c.settings.read(owner),
    },
    update_agent_settings: {
      description:
        "Update user defaults. Omitted fields and existing tasks stay unchanged.",
      schema: settingsUpdateSchema,
      run: (a: any) => c.settings.update(owner, a),
    },
    start_agent_task: {
      description:
        "Create durable asynchronous work in an isolated Git worktree.",
      schema: startSchema.extend({
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
      run: (a: any) => c.start(owner, a),
    },
    get_agent_task: {
      description: "Inspect task state and pending input.",
      schema: taskId,
      run: (a: any) => c.store.get(a.task_id, owner),
    },
    list_agent_tasks: {
      description: "List owned tasks, optionally scoped to a conversation.",
      schema: z.object({ conversation_id: z.string().optional() }),
      run: (a: any) =>
        c.store
          .all(owner)
          .filter(
            (t) =>
              !a.conversation_id || t.conversation_id === a.conversation_id,
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

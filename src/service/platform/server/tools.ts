import type { InputAuthority } from "../../../shared/tasks/model.js";
import type { Control } from "../../features/tasks/runtime/control.js";
import { agentTools } from "./tools/agent-tools.js";
import type { AnyTool, ToolContext } from "./tools/definition.js";
import { userTools } from "./tools/user-tools.js";

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
  const context = { c, owner, authority, hostMeta };
  const agent = agentTools(context);

  return { ...agent, ...userTools(context, agent) };
}

let userToolNames: Set<string> | undefined;

/**
 * Whether a tool is one only the panel calls, acting for the user. Listing
 * the user tools only builds their definitions; it reads no service state.
 */
export function isUserTool(name: string) {
  if (!userToolNames) {
    const context: ToolContext = {
      c: {} as Control,
      owner: "",
      authority: "user",
    };

    userToolNames = new Set(
      Object.keys(userTools(context, agentTools(context))),
    );
  }

  return userToolNames.has(name);
}

/** Whether a tool only reads state; waiting for updates changes nothing. */
export function isReadOnlyTool(name: string) {
  return (
    name.startsWith("get_") ||
    name.startsWith("list_") ||
    name === "wait_user_agent_updates"
  );
}

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

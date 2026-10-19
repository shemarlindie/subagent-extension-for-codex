import type { InputAuthority, Task } from "../../../shared/tasks/model.js";
import type { Control } from "../../features/tasks/runtime/control.js";
import { panelUri } from "../panel/panel.js";
import { taskPanelContext } from "../panel/panel-context.js";
import { observeTool } from "./tool-logging.js";
import { agentTools } from "./tools/agent-tools.js";
import type {
  AnyTool,
  ConversationHints,
  ToolContext,
} from "./tools/definition.js";
import { userTools } from "./tools/user-tools.js";

/** Optional host conversation correlation is a UI scope, never an access grant. */
export function withConversation(
  hints: ConversationHints | undefined,
  args: Record<string, unknown>,
  meta?: Record<string, unknown>,
) {
  if (
    hints === "panel" &&
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
    !hints ||
    args.conversation_id !== undefined ||
    (hints === "panel" && args.task_id !== undefined)
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

/** A task tool's MCP registration, shared by the HTTP and stdio servers. */
export function toolRegistration(name: string, d: AnyTool) {
  return {
    description: d.description,
    inputSchema: d.schema,
    ...(d.outputSchema ? { outputSchema: d.outputSchema } : {}),
    annotations: {
      readOnlyHint: d.readOnly === true,
      destructiveHint: d.destructive === true,
      openWorldHint: d.openWorld === true,
    },
    _meta: {
      ui: {
        visibility: isUserTool(name)
          ? (["app"] as const)
          : (["model", "app"] as const),
        ...(d.panel ? { resourceUri: panelUri } : {}),
      },
      ...(d.panel
        ? { "openai/ui": { preferredModelDisplayMode: "inline" as const } }
        : {}),
    },
  };
}

/**
 * A tool result's structured content. A declared output schema describes the
 * result itself; panel tools add the context that selects the new task.
 */
export function toolStructuredContent(d: AnyTool, result: unknown) {
  if (d.outputSchema) return result as Record<string, unknown>;

  return {
    result,
    ...(d.panel
      ? { ...taskPanelContext(result as Task), tasks: [result] }
      : {}),
  };
}

export async function callTool(
  c: Control,
  owner: string,
  name: string,
  args: unknown,
  authority: InputAuthority = "parent",
  hostMeta?: Record<string, unknown>,
) {
  const defs = definitions(c, owner, authority, hostMeta);

  return observeTool(
    Object.hasOwn(defs, name) ? name : "unknown",
    async () => {
      if (isUserTool(name) && authority !== "user") {
        throw new Error("User tools require a user interface");
      }

      if (!Object.hasOwn(defs, name)) throw new Error("Unknown tool");
      const d: AnyTool = defs[name as keyof typeof defs];

      return d.run(d.schema.parse(args ?? {}));
    },
    Object.hasOwn(defs, name) &&
      defs[name as keyof typeof defs].readOnly === true,
  );
}

import type { InputAuthority, Task } from "../../../shared/tasks/model.js";
import type { Control } from "../../features/tasks/runtime/control.js";
import type { HostAdapter, HostHints } from "../host/host-adapter.js";
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
  host: HostHints = {},
) {
  if (
    hints === "panel" &&
    args.conversation_id !== null &&
    args.task_id === undefined &&
    args.host_directory === undefined &&
    host.directory !== undefined
  ) {
    args = { ...args, host_directory: host.directory };
  }

  // A selected task supplies its own scope; ambient chat hints cannot constrain it.
  if (
    !hints ||
    args.conversation_id !== undefined ||
    (hints === "panel" && args.task_id !== undefined)
  ) {
    return args;
  }

  const session = host.conversation;

  return session?.trim() && session.length <= 256
    ? { ...args, conversation_id: session }
    : args;
}

/** The task tools. With `host`, they include the host's own tools. */
export function definitions(
  c: Control,
  owner: string,
  authority: InputAuthority = "parent",
  hostDirectory?: string,
  host?: HostAdapter,
) {
  const context = { c, owner, authority, hostDirectory, host };
  const agent = agentTools(context);

  return { ...agent, ...userTools(context, agent) };
}

const userToolNames = new Map<HostAdapter | undefined, Set<string>>();

/**
 * Whether a tool is one only the panel or host calls, acting for the user.
 * Listing the user tools only builds their definitions. It reads no service
 * state.
 */
export function isUserTool(name: string, host?: HostAdapter) {
  let names = userToolNames.get(host);

  if (!names) {
    const context: ToolContext = {
      c: {} as Control,
      owner: "",
      authority: "user",
      host,
    };

    names = new Set(Object.keys(userTools(context, agentTools(context))));
    userToolNames.set(host, names);
  }

  return names.has(name);
}

/** A task tool's MCP registration, shared by the HTTP and stdio servers. */
export function toolRegistration(name: string, d: AnyTool, host: HostAdapter) {
  return {
    description: d.description,
    inputSchema: d.schema,
    ...(d.outputSchema ? { outputSchema: d.outputSchema } : {}),
    annotations: {
      readOnlyHint: d.readOnly === true,
      destructiveHint: d.destructive === true,
      openWorldHint: d.openWorld === true,
    },
    // Host metadata comes first, so it can't replace the core `ui` entry.
    _meta: {
      ...(d.panel ? host.panel.taskToolMeta : {}),
      ui: {
        visibility: isUserTool(name, host)
          ? (["app"] as const)
          : (["model", "app"] as const),
        ...(d.panel ? { resourceUri: host.panel.uri } : {}),
      },
    },
  };
}

/**
 * Leaves the queued messages the user removed out of a returned task. The
 * service keeps them only for the panel's undo, and the parent agent doesn't
 * see messages the user withdrew.
 */
export function withoutRemovedQueue(result: unknown) {
  return typeof result === "object" && result && "removed_queue" in result
    ? { ...result, removed_queue: undefined }
    : result;
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
  hostDirectory?: string,
  host?: HostAdapter,
) {
  const defs: Record<string, AnyTool> = definitions(
    c,
    owner,
    authority,
    hostDirectory,
    host,
  );

  const d = Object.hasOwn(defs, name) ? defs[name] : undefined;

  return observeTool(
    d ? name : "unknown",
    async () => {
      if (isUserTool(name, host) && authority !== "user") {
        throw new Error("User tools require a user interface");
      }

      if (!d) throw new Error("Unknown tool");

      return withoutRemovedQueue(await d.run(d.schema.parse(args ?? {})));
    },
    d?.readOnly === true,
  );
}

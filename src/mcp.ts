import {
  McpServer,
  ProtocolError,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { type Events, EventProtocolError } from "./events/service.js";
import { definitions, withConversation } from "./tools.js";
import { type Control } from "./control.js";
import { z } from "zod";
import { settingsCapability } from "./settings.js";
import { delegationPanel } from "./panel.js";
export function mcp(
  c: Control,
  owner: string,
  origin: string,
  htmlPath: string,
  events?: Events,
  nativeHtmlPath = htmlPath,
) {
  const server = new McpServer(
    { name: "codex-subagent-extension", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        extensions: settingsCapability,
        ...(events ? { events: {} } : {}),
      },
      requestState: { verify: (state) => c.forms.verify(owner, state) },
      instructions:
        "Use list_agent_projects and list_available_workers before delegation; pass an explicit repository. Tasks run asynchronously in isolated worktrees. Inspect pending_input before submit_agent_input. Changes are returned as artifacts; applying them is a separate action.",
    },
  );
  server.registerTool(
    "request_agent_task",
    {
      description:
        "Ask the user to choose a worker, task and budgets using a host form, then delegate asynchronously. Use start_agent_task for clients without forms.",
      inputSchema: definitions(c, owner).start_agent_task.schema.extend({
        task: z.string().max(20000).optional(),
      }),
      annotations: { openWorldHint: true },
    },
    async (args, ctx) => {
      try {
        return await c.forms.handle(owner, "request_agent_task", args, ctx);
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: String(error) }],
        };
      }
    },
  );
  server.registerTool(
    "request_agent_input",
    {
      description:
        "Present a task's pending question or permission request in a host form. The response is bound to that exact pending request. Use submit_agent_input for clients without forms.",
      inputSchema: z.strictObject({ task_id: z.string() }),
    },
    async (args, ctx) => {
      try {
        return await c.forms.handle(owner, "request_agent_input", args, ctx);
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: String(error) }],
        };
      }
    },
  );
  for (const [name, d] of Object.entries(definitions(c, owner)))
    server.registerTool(
      name,
      {
        description: d.description,
        inputSchema: d.schema,
        ...("outputSchema" in d ? { outputSchema: d.outputSchema } : {}),
        annotations: {
          readOnlyHint: name.startsWith("get_") || name.startsWith("list_"),
          destructiveHint: name === "cancel_agent_task",
          openWorldHint: name === "start_agent_task",
        },
        _meta: { ui: { visibility: ["model", "app"] } },
      },
      async (args: any, ctx: ServerContext) => {
        try {
          const result = await d.run(
            withConversation(name, args, ctx.mcpReq._meta),
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: name.endsWith("_agent_settings")
              ? result
              : { result },
          };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: String(error) }],
          };
        }
      },
    );
  if (events)
    for (const method of [
      "events/list",
      "events/subscribe",
      "events/unsubscribe",
    ]) {
      server.server.setRequestHandler(
        method,
        {
          params: z
            .object({ _meta: z.record(z.string(), z.unknown()).optional() })
            .passthrough(),
        },
        async (params) => {
          const { _meta, ...args } = params;
          try {
            return {
              resultType: "complete" as const,
              ...(await events.handle(owner, method, args)),
            };
          } catch (e) {
            if (e instanceof EventProtocolError)
              throw new ProtocolError(
                e.code,
                e.message,
                e.reason ? { reason: e.reason } : undefined,
              );
            throw e;
          }
        },
      );
    }
  const panel = delegationPanel(nativeHtmlPath, (conversationId) =>
    c.store
      .all(owner)
      .filter((t) => !conversationId || t.conversation_id === conversationId),
  );
  server.registerTool(panel.name, panel.tool, (args, ctx) =>
    panel.open(withConversation(panel.name, args, ctx.mcpReq._meta)),
  );
  server.registerResource(panel.title, panel.uri, panel.resource, panel.read);
  return server;
}

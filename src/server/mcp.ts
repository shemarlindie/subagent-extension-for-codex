import {
  McpServer,
  ProtocolError,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { type Events, EventProtocolError } from "../events/service.js";
import { definitions, withConversation } from "./tools.js";
import { type Control } from "../core/control.js";
import { z } from "zod";
import { withSettingsCapability } from "../core/settings.js";
import { delegationPanel, panelUri } from "../panel/panel.js";
import {
  resolvePanelContext,
  taskPanelContext,
} from "../panel/panel-context.js";
import type { Task } from "../core/model.js";
import { codexContextCapability } from "../panel/host-context.js";
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
        ...withSettingsCapability(codexContextCapability),
        tools: {},
        ...(events ? { events: {} } : {}),
      },
      requestState: { verify: (state) => c.forms.verify(owner, state) },
      instructions:
        "Use list_agent_projects and list_available_workers before delegation; pass an explicit repository. Tasks run asynchronously in the current repository by default, including uncommitted changes; choose workspace_strategy worktree for an isolated committed revision. Inspect pending_input before submit_agent_input. Worktree changes are returned as artifacts; current_repo write profiles edit the checkout directly.",
    },
  );
  server.registerTool(
    "request_agent_task",
    {
      description:
        "Ask the user for the full request as the description, worker and budgets using a host form, then delegate asynchronously with an automatically generated title. Use start_agent_task for clients without forms.",
      inputSchema: definitions(c, owner).start_agent_task.schema.extend({
        title: z.string().max(120).optional(),
        description: z.string().max(20000).optional(),
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
        _meta: {
          ui: {
            visibility: ["model", "app"],
            ...(name === "start_agent_task" ? { resourceUri: panelUri } : {}),
          },
          ...(name === "start_agent_task"
            ? { "openai/ui": { preferredModelDisplayMode: "inline" } }
            : {}),
        },
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
              : {
                  result,
                  ...(name === "start_agent_task"
                    ? { ...taskPanelContext(result as Task), tasks: [result] }
                    : {}),
                },
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
  const panel = delegationPanel(
    nativeHtmlPath,
    (conversationId) =>
      c.store
        .all(owner)
        .filter((t) => !conversationId || t.conversation_id === conversationId),
    (args) => resolvePanelContext(c, owner, args),
  );
  server.registerTool(panel.name, panel.tool, async (args, ctx) => {
    try {
      return await panel.open(
        withConversation(panel.name, args, ctx.mcpReq._meta),
      );
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: String(error) }],
      };
    }
  });
  server.registerResource(panel.title, panel.uri, panel.resource, panel.read);
  server.registerTool(panel.global.name, panel.global.tool, async () => {
    try {
      return await panel.global.open();
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: String(error) }],
      };
    }
  });
  return server;
}

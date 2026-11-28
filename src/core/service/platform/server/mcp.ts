import {
  McpServer,
  type CallToolResult,
  type ServerContext,
} from "@modelcontextprotocol/server";

import { SendRejectedError } from "../../../shared/tasks/conversation/send-errors.js";
import { type Control } from "../../features/tasks/runtime/control.js";
import type { HostAdapter } from "../host/host-adapter.js";
import { panelTaskList, resolvePanelContext } from "../panel/panel-context.js";
import { delegationPanel } from "../panel/panel.js";
import { packageVersion } from "../service/runtime.js";
import { productGlyphIcons } from "./product-glyph.js";
import { observeTool } from "./tool-logging.js";
import {
  definitions,
  toolRegistration,
  toolStructuredContent,
  withConversation,
  withoutRemovedQueue,
} from "./tools.js";
import type { AnyTool } from "./tools/definition.js";

/** The text the HTTP API reports for the same failure, without a class name. */
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function mcp(
  c: Control,
  owner: string,
  host: HostAdapter,
  htmlPath: string,
  nativeHtmlPath = htmlPath,
) {
  const server = new McpServer(
    {
      name: "subagent-extension-for-codex",
      version: packageVersion,
      icons: productGlyphIcons,
    },
    {
      capabilities: { ...host.capabilities, tools: {} },
      instructions: host.instructions,
    },
  );

  host.register(server, c);
  // The host registers its own tools above, so these are the core tools only.
  const tools: Record<string, AnyTool> = definitions(c, owner);

  for (const [name, d] of Object.entries(tools)) {
    server.registerTool(
      name,
      toolRegistration(name, d, host),
      async (args, ctx: ServerContext): Promise<CallToolResult> => {
        try {
          const hints = host.hints(ctx.mcpReq._meta);

          const current: Record<string, AnyTool> = definitions(
            c,
            owner,
            "parent",
            hints.directory,
          );

          const definition = current[name];
          if (!definition) throw new Error(`Unknown tool: ${name}`);

          const result = withoutRemovedQueue(
            await observeTool(
              name,
              () =>
                definition.run(
                  withConversation(definition.conversation, args, hints),
                ),
              definition.readOnly === true,
            ),
          );

          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: toolStructuredContent(definition, result),
          };
        } catch (error) {
          return {
            isError: true,
            ...(error instanceof SendRejectedError
              ? { _meta: { send_rejected: true } }
              : {}),
            content: [{ type: "text", text: errorText(error) }],
          };
        }
      },
    );
  }

  const panel = delegationPanel(
    host.panel,
    nativeHtmlPath,
    (scope) => panelTaskList(c, owner, scope, false),
    (args) => resolvePanelContext(c, owner, args),
  );

  server.registerTool(
    panel.name,
    panel.tool,
    async (args, ctx): Promise<CallToolResult> => {
      try {
        return await panel.open(
          withConversation("panel", args, host.hints(ctx.mcpReq._meta)),
        );
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: errorText(error) }],
        };
      }
    },
  );

  server.registerResource(panel.title, panel.uri, panel.resource, panel.read);

  server.registerTool(
    panel.global.name,
    panel.global.tool,
    async (): Promise<CallToolResult> => {
      try {
        return await panel.global.open();
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: errorText(error) }],
        };
      }
    },
  );

  return server;
}

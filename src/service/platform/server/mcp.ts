import {
  type CallToolResult,
  McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";

import { SendRejectedError } from "../../../shared/tasks/conversation/send-errors.js";
import { type Control } from "../../features/tasks/runtime/control.js";
import { codexContextCapability } from "../panel/host-context.js";
import { delegationPanel } from "../panel/panel.js";
import { openingTasks, resolvePanelContext } from "../panel/panel-context.js";
import { packageVersion } from "../service/runtime.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import {
  claudeMentionResource,
  claudeMentionUri,
  composerMentionsEnabled,
  mentionSearchToolConfig,
  mentionSearchToolName,
  readClaudeMention,
  searchAgentMentions,
} from "./mentions.js";
import { productGlyphIcons } from "./product-glyph.js";
import { observeTool } from "./tool-logging.js";
import {
  definitions,
  toolRegistration,
  toolStructuredContent,
  withConversation,
} from "./tools.js";
import type { AnyTool } from "./tools/definition.js";

export function mcp(
  c: Control,
  owner: string,
  origin: string,
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
      capabilities: {
        ...codexContextCapability,
        tools: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Temporary feature gate.
  if (composerMentionsEnabled) {
    server.registerTool(
      mentionSearchToolName,
      mentionSearchToolConfig,
      async ({ query }) => ({
        content: [],
        structuredContent: await searchAgentMentions(query, c.workers()),
      }),
    );

    server.registerResource(
      "Claude provider mention",
      claudeMentionUri,
      claudeMentionResource,
      () => readClaudeMention(),
    );
  }

  const tools: Record<string, AnyTool> = definitions(c, owner);

  for (const [name, d] of Object.entries(tools)) {
    if (name === mentionSearchToolName) continue;

    server.registerTool(
      name,
      toolRegistration(name, d),
      async (args, ctx: ServerContext): Promise<CallToolResult> => {
        try {
          const current: Record<string, AnyTool> = definitions(
            c,
            owner,
            "parent",
            ctx.mcpReq._meta,
          );

          const definition = current[name];
          if (!definition) throw new Error(`Unknown tool: ${name}`);

          const result = await observeTool(
            name,
            () =>
              definition.run(
                withConversation(
                  definition.conversation,
                  args,
                  ctx.mcpReq._meta,
                ),
              ),
            definition.readOnly === true,
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
            content: [{ type: "text", text: String(error) }],
          };
        }
      },
    );
  }

  const panel = delegationPanel(
    nativeHtmlPath,
    (conversationId) => openingTasks(c, owner, conversationId),
    (args) => resolvePanelContext(c, owner, args),
  );

  server.registerTool(
    panel.name,
    panel.tool,
    async (args, ctx): Promise<CallToolResult> => {
      try {
        return await panel.open(
          withConversation("panel", args, ctx.mcpReq._meta),
        );
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: String(error) }],
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
          content: [{ type: "text", text: String(error) }],
        };
      }
    },
  );

  return server;
}

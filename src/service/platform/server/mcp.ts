import {
  type CallToolResult,
  McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";

import { PARENT_DELEGATION_PROTOCOL } from "../../../shared/tasks/conversation/parent-protocol.js";
import { SendRejectedError } from "../../../shared/tasks/conversation/send-errors.js";
import { type Control } from "../../features/tasks/runtime/control.js";
import { codexContextCapability } from "../panel/host-context.js";
import { delegationPanel } from "../panel/panel.js";
import { openingTasks, resolvePanelContext } from "../panel/panel-context.js";
import { packageVersion } from "../service/runtime.js";
import {
  claudeMentionResource,
  claudeMentionUri,
  mentionSearchToolConfig,
  mentionSearchToolName,
  readClaudeMention,
  searchAgentMentions,
} from "./mentions.js";
import { productGlyphIcons } from "./product-glyph.js";
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
      name: "codex-subagent-extension",
      version: packageVersion,
      icons: productGlyphIcons,
    },
    {
      capabilities: {
        ...codexContextCapability,
        tools: {},
      },
      instructions:
        "Use get_current_project and list_workers before delegation. A selected Claude composer mention is a provider hint only; use the available reviewer profile for review requests, and resolve the repository through existing project checks. Mention selection does not authorize a project or change permissions. Starting a task for the current chat project registers it when the user setting allows; otherwise ask the user to use Add project in the panel, then pass its explicit repository. Tasks run asynchronously in the current repository by default, including uncommitted changes; choose workspace_strategy worktree for an isolated committed revision. Inspect pending_input before submit_input; Claude permission decisions require provider_options.claude.approval_decider to be parent_agent. Use the panel approval buttons for permissions routed to the user. Provider-owned task settings are isolated under provider_options.<provider_id>. Worktree changes are on the task's branch, <worktree_branch_prefix><task-id> (task.branch), in its worktree; current_repo write profiles edit the checkout directly. Read what a task changed with get_changes, which diffs live from Git; never rely on the worker's own list of changed files. A task is a conversation: read its replies with list_messages (a long poll with wait_seconds), and send follow-ups, steers or queued messages with send_message. A completed task stays open for more messages until it is deleted." +
        " " +
        PARENT_DELEGATION_PROTOCOL,
    },
  );

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

          const result = await definition.run(
            withConversation(definition.conversation, args, ctx.mcpReq._meta),
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

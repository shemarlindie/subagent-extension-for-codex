import {
  McpServer,
  ProtocolError,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  EventProtocolError,
  type Events,
} from "../../features/events/service.js";
import { autoRegisterChatProject } from "../../features/projects/chat-project.js";
import { type Control } from "../../features/tasks/control.js";
import type { Task } from "../../shared/contracts.js";
import { codexContextCapability } from "../panel/host-context.js";
import { delegationPanel, panelUri } from "../panel/panel.js";
import {
  resolvePanelContext,
  taskPanelContext,
} from "../panel/panel-context.js";
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
  type AnyTool,
  definitions,
  isUserTool,
  withConversation,
} from "./tools.js";

export function mcp(
  c: Control,
  owner: string,
  origin: string,
  htmlPath: string,
  events?: Events,
  nativeHtmlPath = htmlPath,
) {
  const server = new McpServer(
    {
      name: "codex-subagent-extension",
      version: "0.1.0",
      icons: productGlyphIcons,
    },
    {
      capabilities: {
        ...codexContextCapability,
        tools: {},
        ...(events ? { events: {} } : {}),
      },
      requestState: { verify: (state) => c.forms.verify(owner, state) },
      instructions:
        "Use get_current_agent_project and list_available_workers before delegation. A selected Claude composer mention is a provider hint only; use the available reviewer profile for review requests, and resolve the repository through existing project checks. Mention selection does not authorize a project or change permissions. Starting a task for the current chat project registers it when the user setting allows; otherwise request_agent_project asks the user, then pass its explicit repository. Tasks run asynchronously in the current repository by default, including uncommitted changes; choose workspace_strategy worktree for an isolated committed revision. Inspect pending_input before submit_agent_input; Claude permission decisions require provider_options.claude.approval_decider to be parent_agent. Use request_agent_input or user buttons for permissions routed to the user. Provider-owned task settings are isolated under provider_options.<provider_id>. Worktree changes are on the task's branch, <worktree_branch_prefix><task-id> (task.branch), in its worktree; current_repo write profiles edit the checkout directly. Read what a task changed with get_agent_changes, which diffs live from Git; never rely on the worker's own list of changed files.",
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

  server.registerTool(
    "request_agent_task",
    {
      description:
        "Ask the user for the full request as the description, worker and budgets using a host form, then delegate asynchronously with an automatically generated title. Use start_agent_task for clients without forms.",
      inputSchema: definitions(c, owner).start_agent_task.schema.extend({
        description: z.string().max(20000).optional(),
      }),
      annotations: { openWorldHint: true },
    },
    async (args, ctx) => {
      try {
        await autoRegisterChatProject(
          c,
          owner,
          ctx.mcpReq._meta,
          typeof args.repository === "string" ? args.repository : undefined,
        );

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
    "request_agent_project",
    {
      description:
        "Ask the user to approve registering a local Git repository from this chat. Supply its actual absolute path, or omit it to prefill host directory metadata. Registers only after an accepted user approval; then continue delegation with the returned repository.",
      inputSchema: z.strictObject({
        repository: z.string().min(1).max(4096).optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args, ctx) => {
      try {
        return await c.forms.handle(owner, "request_agent_project", args, ctx);
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
        "Present a task's pending question or permission request in a host form. The response is bound to that exact pending request. User buttons are also available; submit_agent_input can decide Claude permissions only when provider_options.claude.approval_decider is parent_agent.",
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

  const tools: Record<string, AnyTool> = definitions(c, owner);

  for (const [name, d] of Object.entries(tools)) {
    if (name === mentionSearchToolName) continue;

    server.registerTool(
      name,
      {
        description: d.description,
        inputSchema: d.schema,
        ...(d.outputSchema ? { outputSchema: d.outputSchema } : {}),
        annotations: {
          readOnlyHint: name.startsWith("get_") || name.startsWith("list_"),
          destructiveHint: [
            "cancel_agent_task",
            "remove_user_agent_worktree",
            "delete_user_agent_task",
            "delete_user_agent_branch",
          ].includes(name),
          openWorldHint: name === "start_agent_task",
        },
        _meta: {
          ui: {
            visibility: isUserTool(name) ? ["app"] : ["model", "app"],
            ...(name === "start_agent_task" ? { resourceUri: panelUri } : {}),
          },
          ...(name === "start_agent_task"
            ? { "openai/ui": { preferredModelDisplayMode: "inline" } }
            : {}),
        },
      },
      async (args, ctx: ServerContext) => {
        try {
          const current: Record<string, AnyTool> = definitions(
            c,
            owner,
            "parent",
            ctx.mcpReq._meta,
          );

          const result = await current[name].run(
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
  }

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

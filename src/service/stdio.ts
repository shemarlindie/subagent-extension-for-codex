import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { PARENT_DELEGATION_PROTOCOL } from "../shared/tasks/conversation/parent-protocol.js";
import type { Task } from "../shared/tasks/model.js";
import { hostDirectoryFromMeta } from "./features/projects/chat-project.js";
import { type Control } from "./features/tasks/runtime/control.js";
import { codexContextCapability } from "./platform/panel/host-context.js";
import { delegationPanel, panelUri } from "./platform/panel/panel.js";
import { taskPanelContext } from "./platform/panel/panel-context.js";
import {
  claudeMentionResource,
  claudeMentionUri,
  mentionSearchSchema,
  mentionSearchToolConfig,
  mentionSearchToolName,
  mentionTestModeEnv,
  readClaudeMention,
  resolveMentionSearchEnv,
  searchAgentMentions,
} from "./platform/server/mentions.js";
import { productGlyphIcons } from "./platform/server/product-glyph.js";
import {
  definitions,
  isReadOnlyTool,
  isUserTool,
  withConversation,
} from "./platform/server/tools.js";
import type { AnyTool } from "./platform/server/tools/definition.js";
import { connectService } from "./platform/service/launcher.js";
import {
  installRoot,
  packagePath,
  packageVersion,
} from "./platform/service/runtime.js";
import { serviceClient } from "./platform/service/service-client.js";

let mentionSearchEnv = resolveMentionSearchEnv(process.env, {}, installRoot);

try {
  const envFile = await readFile(packagePath(".env"), "utf8");

  mentionSearchEnv = resolveMentionSearchEnv(
    process.env,
    parseEnv(envFile),
    installRoot,
  );
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

const service = serviceClient(connectService);

/** Read-only tools, which the proxy may safely send twice. */
function readOnly(name: string) {
  return isReadOnlyTool(name) || name === mentionSearchToolName;
}

/** Forwards a tool call to the service's tool API. */
function postService(
  name: string,
  body: unknown,
  timeout: number,
  headers: Record<string, string> = {},
) {
  return service.post(
    `${isUserTool(name) ? "user-tools" : "tools"}/${name}`,
    body,
    { timeout, headers, readOnly: readOnly(name) },
  );
}

// Start finding or launching the service now. Calls wait for it.
service.connect().catch(() => {});

const server = new McpServer(
  {
    name: "codex-subagent-extension",
    version: packageVersion,
    icons: productGlyphIcons,
  },
  {
    instructions:
      "Use list_agent_projects and pass an explicit approved absolute repository to start_agent_task. current cannot identify the host chat project. Use get_current_agent_project for host project discovery. A selected Claude composer mention is a provider hint only; use the available reviewer profile for review requests, and resolve the repository through existing project checks. Mention selection does not authorize a project or change permissions. Starting a task for the current chat project registers it when the user setting allows; otherwise ask the user to use Add project in the panel." +
      " " +
      PARENT_DELEGATION_PROTOCOL,
    capabilities: codexContextCapability,
  },
);

/**
 * How long a proxied call may take: the folder picker waits for the user,
 * and message and update reads wait as long as they were asked to, plus a
 * margin.
 */
function serviceTimeout(name: string, args: Record<string, unknown>) {
  if (name === "browse_user_agent_project") return 150000;

  if (name === "get_agent_messages") {
    return Math.min(Number(args.wait_seconds) || 0, 50) * 1000 + 10000;
  }

  if (name === "wait_user_agent_updates") {
    return Math.min(Number(args.wait_ms) || 0, 25000) + 10000;
  }

  return 30000;
}

async function serviceTool(name: string, args: Record<string, unknown>) {
  const response = await postService(name, args, 30000);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Service request failed");

  return body.result;
}

server.registerTool(
  mentionSearchToolName,
  {
    ...mentionSearchToolConfig,
    // The extension schemas use a separate Zod version with compatible runtime parsing.
    inputSchema:
      mentionSearchToolConfig.inputSchema as unknown as typeof mentionSearchSchema,
    outputSchema: mentionSearchToolConfig.outputSchema as unknown as z.ZodType,
  },
  async ({ query }) => ({
    content: [],
    structuredContent:
      mentionSearchEnv[mentionTestModeEnv] === "1"
        ? await searchAgentMentions(query, [], mentionSearchEnv)
        : await serviceTool(mentionSearchToolName, { query }),
  }),
);

server.registerResource(
  "Claude provider mention",
  claudeMentionUri,
  claudeMentionResource,
  () => readClaudeMention(mentionSearchEnv),
);

// Definitions supply schemas only; the proxy forwards calls to the service.
const tools: Record<string, AnyTool> = definitions({} as Control, "local");

for (const [name, d] of Object.entries(tools)) {
  if (name === mentionSearchToolName) continue;

  server.registerTool(
    name,
    {
      description: d.description,
      inputSchema: d.schema,
      ...(d.outputSchema ? { outputSchema: d.outputSchema } : {}),
      annotations: {
        readOnlyHint: isReadOnlyTool(name),
        destructiveHint: [
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
    async (
      args,
      extra: { _meta?: Record<string, unknown> },
    ): Promise<CallToolResult> => {
      try {
        const hostDirectory = hostDirectoryFromMeta(extra._meta);

        const response = await postService(
          name,
          withConversation(name, args, extra._meta),
          serviceTimeout(name, args),
          hostDirectory
            ? { "X-Codex-Host-Directory": encodeURIComponent(hostDirectory) }
            : {},
        );

        const body = await response.json();

        return {
          isError: !response.ok,
          content: [{ type: "text", text: JSON.stringify(body) }],
          ...(response.ok
            ? {
                structuredContent: name.endsWith("_agent_settings")
                  ? body.result
                  : {
                      ...body,
                      ...(name === "start_agent_task"
                        ? {
                            ...taskPanelContext(body.result as Task),
                            tasks: [body.result],
                          }
                        : {}),
                    },
              }
            : {}),
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Subagent extension service unavailable: ${String(error)}`,
            },
          ],
        };
      }
    },
  );
}

const panel = delegationPanel(
  packagePath("dist/app.html"),
  undefined,
  async (args) => {
    const response = await postService("get_agent_panel_context", args, 30000);

    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.error ?? "Panel context unavailable");
    }

    return body.result;
  },
);

server.registerTool(
  panel.name,
  panel.tool,
  async (args, extra): Promise<CallToolResult> => {
    try {
      return await panel.open(withConversation(panel.name, args, extra._meta));
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

await server.connect(new StdioServerTransport());

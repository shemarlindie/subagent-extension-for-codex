import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { hostDirectoryFromMeta } from "./features/projects/chat-project.js";
import { type Control } from "./features/tasks/control.js";
import { hostProjectCandidate } from "./platform/panel/host-context.js";
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
  type AnyTool,
  definitions,
  isUserTool,
  withConversation,
} from "./platform/server/tools.js";
import { connectService } from "./platform/service/launcher.js";
import type { Task } from "./shared/contracts.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let mentionSearchEnv = resolveMentionSearchEnv(process.env, {}, packageRoot);

try {
  const envPath = resolve(packageRoot, ".env");
  const envFile = await readFile(envPath, "utf8");

  mentionSearchEnv = resolveMentionSearchEnv(
    process.env,
    parseEnv(envFile),
    packageRoot,
  );
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
    throw error;
}

const { token, origin } = await connectService();

const server = new McpServer(
  {
    name: "codex-subagent-extension",
    version: "0.1.0",
    icons: productGlyphIcons,
  },
  {
    instructions:
      "Use list_agent_projects and pass an explicit approved absolute repository to start_agent_task. current cannot identify the host chat project. Use get_current_agent_project for host project discovery. A selected Claude composer mention is a provider hint only; use the available reviewer profile for review requests, and resolve the repository through existing project checks. Mention selection does not authorize a project or change permissions. Starting a task for the current chat project registers it when the user setting allows; otherwise request_agent_project asks the user to confirm registration.",
    capabilities: codexContextCapability,
  },
);

/**
 * How long a proxied call may take: the folder picker waits for the user,
 * and a message read waits as long as it was asked to, plus a margin.
 */
function serviceTimeout(name: string, args: Record<string, unknown>) {
  if (name === "browse_user_agent_project") return 150000;

  if (name === "get_agent_messages")
    return Math.min(Number(args.wait_seconds) || 0, 50) * 1000 + 10000;

  return 30000;
}

async function serviceTool(name: string, args: Record<string, unknown>) {
  const response = await fetch(
    `${origin}/api/${isUserTool(name) ? "user-tools" : "tools"}/${name}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Codex-Subagent-Extension": "1",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    },
  );

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

server.registerTool(
  "request_agent_project",
  {
    description:
      "Ask the user to approve registering a local Git repository from this chat. Supply its actual absolute path, or omit it to prefill host directory metadata. Continue delegation with the returned repository after approval.",
    inputSchema: z.strictObject({
      repository: z.string().min(1).max(4096).optional(),
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async (args, extra) => {
    try {
      const capabilities = server.server.getClientCapabilities()?.elicitation;
      if (
        !capabilities ||
        (Object.keys(capabilities).length > 0 && !capabilities.form)
      )
        throw new Error(
          "This host cannot show registration confirmations. Use Add project in the panel, or enable Automatically add chat projects in user settings and start the task from this chat.",
        );

      const repository =
        args.repository ??
        (await hostProjectCandidate(hostDirectoryFromMeta(extra._meta)));

      const answer = await server.server.elicitInput(
        {
          mode: "form",
          message:
            "Approve access to a local Git repository for delegated tasks. Registration covers this Git root only. No task starts until requested separately.",
          requestedSchema: {
            type: "object",
            properties: {
              repository: {
                type: "string",
                title: "Repository path",
                minLength: 1,
                maxLength: 4096,
                ...(repository ? { default: repository } : {}),
              },
              decision: {
                type: "string",
                title: "Repository access",
                enum: ["deny", "allow"],
                default: "deny",
              },
            },
            required: ["repository", "decision"],
          },
        },
        { timeout: 600000 },
      );

      if (answer.action !== "accept")
        return {
          content: [{ type: "text", text: "Project registration cancelled." }],
          structuredContent: { result: { cancelled: true } },
        };

      const content = z
        .strictObject({
          repository: z.string().min(1).max(4096),
          decision: z.enum(["deny", "allow"]),
        })
        .parse(answer.content);

      const result =
        content.decision === "allow"
          ? await serviceTool("register_user_agent_project", {
              repository: content.repository,
            })
          : { cancelled: true };

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: { result },
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: String(error) }],
      };
    }
  },
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
        readOnlyHint: name.startsWith("get_") || name.startsWith("list_"),
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
    async (args, extra: { _meta?: Record<string, unknown> }) => {
      try {
        const response = await fetch(
          `${origin}/api/${isUserTool(name) ? "user-tools" : "tools"}/${name}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              "X-Codex-Subagent-Extension": "1",
              ...(hostDirectoryFromMeta(extra._meta)
                ? {
                    "X-Codex-Host-Directory": encodeURIComponent(
                      hostDirectoryFromMeta(extra._meta)!,
                    ),
                  }
                : {}),
            },
            body: JSON.stringify(withConversation(name, args, extra._meta)),
            signal: AbortSignal.timeout(serviceTimeout(name, args)),
            redirect: "error",
          },
        );

        const body = await response.json();

        return {
          isError: !response.ok,
          content: [{ type: "text" as const, text: JSON.stringify(body) }],
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
              type: "text" as const,
              text: `Subagent extension service unavailable: ${String(error)}`,
            },
          ],
        };
      }
    },
  );
}

const panel = delegationPanel(
  resolve(dirname(fileURLToPath(import.meta.url)), "../dist/app.html"),
  undefined,
  async (args) => {
    const response = await fetch(
      `${origin}/api/tools/get_agent_panel_context`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Codex-Subagent-Extension": "1",
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      },
    );

    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error ?? "Panel context unavailable");

    return body.result;
  },
);

server.registerTool(panel.name, panel.tool, async (args, extra) => {
  try {
    return await panel.open(withConversation(panel.name, args, extra._meta));
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

await server.connect(new StdioServerTransport());

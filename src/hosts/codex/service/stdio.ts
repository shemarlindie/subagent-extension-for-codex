import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { type Control } from "../../../core/service/features/tasks/runtime/control.js";
import { delegationPanel } from "../../../core/service/platform/panel/panel.js";
import { productGlyphIcons } from "../../../core/service/platform/server/product-glyph.js";
import {
  definitions,
  isUserTool,
  toolRegistration,
  toolStructuredContent,
  withConversation,
} from "../../../core/service/platform/server/tools.js";
import type { AnyTool } from "../../../core/service/platform/server/tools/definition.js";
import { connectService } from "../../../core/service/platform/service/launcher.js";
import {
  installRoot,
  packagePath,
  packageVersion,
} from "../../../core/service/platform/service/runtime.js";
import {
  holdPresence,
  serviceClient,
} from "../../../core/service/platform/service/service-client.js";
import { registerProviders } from "../../../core/shared/providers/registry.js";
import { claudeDefinition } from "../../../providers/claude/shared/definition.js";
import { fixtureDefinition } from "../../../providers/fixture/shared/definition.js";
import { codexHost } from "./host.js";
import {
  composerMentionsEnabled,
  mentionSearchToolName,
  mentionTestModeEnv,
  registerMentions,
  resolveMentionSearchEnv,
  searchAgentMentions,
} from "./mentions.js";

registerProviders([claudeDefinition, fixtureDefinition]);

const service = serviceClient(async () => {
  const connection = await connectService();
  holdPresence(connection);

  return connection;
});

// Definitions supply schemas only; the proxy forwards calls to the service.
const tools: Record<string, AnyTool> = definitions(
  {} as Control,
  "local",
  "parent",
  undefined,
  codexHost,
);

/** Read-only tools, which the proxy may safely send twice. */
function readOnly(name: string) {
  return tools[name]?.readOnly === true;
}

/** Forwards a tool call to the service's tool API. */
function postService(
  name: string,
  body: unknown,
  timeout: number,
  headers: Record<string, string> = {},
) {
  return service.post(
    `${isUserTool(name, codexHost) ? "user-tools" : "tools"}/${name}`,
    body,
    { timeout, headers, readOnly: readOnly(name) },
  );
}

// Start finding or launching the service now. Calls wait for it.
service.connect().catch(() => {});

const server = new McpServer(
  {
    name: "subagent-extension-for-codex",
    version: packageVersion,
    icons: productGlyphIcons,
  },
  {
    instructions: codexHost.instructions,
    capabilities: codexHost.capabilities,
  },
);

/**
 * How long a proxied call may take: the folder picker waits for the user,
 * and message and update reads wait as long as they were asked to, plus a
 * margin.
 */
function serviceTimeout(name: string, args: Record<string, unknown>) {
  if (name === "app_browse_project") return 150000;

  if (name === "list_messages") {
    return Math.min(Number(args.wait_seconds) || 0, 50) * 1000 + 10000;
  }

  if (name === "app_wait_for_updates") {
    return Math.min(Number(args.wait_ms) || 0, 25000) + 10000;
  }

  return 30000;
}

/**
 * The encoded directory hint, or nothing for a path too long for a header.
 * An older service with the same API version can still serve the proxy while
 * it drains, and it reads only `X-Codex-Host-Directory`, so the proxy sends
 * both names until the API version changes.
 */
function hostDirectoryHeader(directory?: string) {
  return directory && directory.length <= 4096
    ? encodeURIComponent(directory)
    : undefined;
}

async function serviceTool(name: string, args: Record<string, unknown>) {
  const response = await postService(name, args, 30000);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Service request failed");

  return body.result;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Temporary feature gate.
if (composerMentionsEnabled) {
  let mentionSearchEnv = resolveMentionSearchEnv(process.env, {}, installRoot);

  try {
    const envFile = await readFile(packagePath(".env"), "utf8");

    mentionSearchEnv = resolveMentionSearchEnv(
      process.env,
      parseEnv(envFile),
      installRoot,
    );
  } catch (error) {
    if (!(
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )) {
      throw error;
    }
  }

  registerMentions(
    server,
    (query) =>
      mentionSearchEnv[mentionTestModeEnv] === "1"
        ? searchAgentMentions(query, [], mentionSearchEnv)
        : serviceTool(mentionSearchToolName, { query }),
    mentionSearchEnv,
  );
}

for (const [name, d] of Object.entries(tools)) {
  if (name === mentionSearchToolName) continue;

  server.registerTool(
    name,
    toolRegistration(name, d, codexHost),
    async (
      args,
      extra: { _meta?: Record<string, unknown> },
    ): Promise<CallToolResult> => {
      const started = Date.now();

      // Codex records proxy stderr. Messages can hold user content, so log only the outcome.
      const fail = (outcome: string) =>
        console.error(
          `Proxy tool failed: ${name} ${outcome} after ${Date.now() - started} ms`,
        );

      try {
        const hints = codexHost.hints(extra._meta);
        const directory = hostDirectoryHeader(hints.directory);

        const response = await postService(
          name,
          withConversation(d.conversation, args, hints),
          serviceTimeout(name, args),
          directory
            ? {
                "X-Host-Directory": directory,
                "X-Codex-Host-Directory": directory,
              }
            : {},
        );

        const body = await response.json();

        if (!response.ok) {
          fail(`HTTP ${response.status}`);

          return {
            isError: true,
            ...(body.send_rejected === true
              ? { _meta: { send_rejected: true } }
              : {}),
            content: [
              { type: "text", text: body.error ?? "Service request failed" },
            ],
          };
        }

        return {
          isError: false,
          content: [{ type: "text", text: JSON.stringify(body) }],
          structuredContent: toolStructuredContent(d, body.result),
        };
      } catch (error) {
        fail(error instanceof Error ? error.name : "NonError");

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
  codexHost.panel,
  packagePath("dist/app.html"),
  undefined,
  async (args) => {
    const response = await postService("get_panel_context", args, 30000);

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
      return await panel.open(
        withConversation("panel", args, codexHost.hints(extra._meta)),
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

// JSON parse errors can quote the message, which can hold user content.
server.server.onerror = (error) =>
  console.error(
    `Proxy transport error: ${error instanceof SyntaxError ? "invalid JSON" : error.message}`,
  );

// The transport closes and stops reading once a message passes its buffer
// limit, 10 MiB by default. Accept what the service's 70 MB tool routes take.
await server.connect(
  new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 70 * 1024 * 1024,
  }),
);

// Codex records MCP server stderr, so these lines show how the proxy ended.
function stdinClosed() {
  console.error("Proxy stopping: stdin closed");
  // Codex closes stdin to stop the proxy. The presence stream would otherwise
  // keep it running.
  process.exit(0);
}

process.stdin.once("end", stdinClosed);
process.stdin.once("close", stdinClosed);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.error(`Proxy stopping: ${signal}`);
    // The handler is gone now, so the signal ends the process as usual.
    process.kill(process.pid, signal);
  });
}

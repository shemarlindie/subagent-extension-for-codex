import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { definitions } from "./tools.js";
import { type Control } from "./control.js";
import { settingsCapability } from "./settings.js";
import { delegationPanel } from "./panel.js";
const token =
  process.env.CODEX_SUBAGENT_EXTENSION_TOKEN ??
  readFileSync(
    resolve(
      process.env.CODEX_SUBAGENT_EXTENSION_DATA ??
        resolve(
          dirname(fileURLToPath(import.meta.url)),
          "../.codex-subagent-extension",
        ),
      "admin-token",
    ),
    "utf8",
  ).trim();
const origin =
  process.env.CODEX_SUBAGENT_EXTENSION_URL ?? "http://127.0.0.1:4317";
const url = new URL(origin);
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  throw new Error("Local stdio proxy requires a loopback service");
const server = new McpServer(
  { name: "codex-subagent-extension", version: "0.1.0" },
  { capabilities: { extensions: settingsCapability } },
);
for (const [name, d] of Object.entries(definitions({} as Control, "local")))
  server.registerTool(
    name,
    {
      description: d.description,
      inputSchema: d.schema,
      annotations: {
        readOnlyHint: name.startsWith("get_") || name.startsWith("list_"),
        destructiveHint: name === "cancel_agent_task",
        openWorldHint: name === "start_agent_task",
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args: any) => {
      try {
        const response = await fetch(`${origin}/api/tools/${name}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Codex-Subagent-Extension": "1",
          },
          body: JSON.stringify(args),
        });
        const body = await response.json();
        return {
          isError: !response.ok,
          content: [{ type: "text" as const, text: JSON.stringify(body) }],
          ...(response.ok
            ? {
                structuredContent: name.endsWith("_agent_settings")
                  ? body.result
                  : body,
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
const panel = delegationPanel(
  resolve(dirname(fileURLToPath(import.meta.url)), "../dist/codex.html"),
);
server.registerTool(panel.name, panel.tool, panel.open);
server.registerResource(panel.title, panel.uri, panel.resource, panel.read);
await server.connect(new StdioServerTransport());

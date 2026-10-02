import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connectService } from "./launcher.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { definitions, withConversation } from "./tools.js";
import { type Control } from "./control.js";
import { settingsCapability } from "./settings.js";
import { delegationPanel } from "./panel.js";
const { token, origin } = await connectService();
const server = new McpServer(
  { name: "codex-subagent-extension", version: "0.1.0" },
  {
    instructions:
      "Use list_agent_projects and pass an explicit approved absolute repository to start_agent_task. current cannot identify the host chat project. Missing projects require registration with the local projects CLI.",
    capabilities: { extensions: settingsCapability },
  },
);
for (const [name, d] of Object.entries(definitions({} as Control, "local")))
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
    async (args: any, extra: { _meta?: Record<string, unknown> }) => {
      try {
        const response = await fetch(`${origin}/api/tools/${name}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "X-Codex-Subagent-Extension": "1",
          },
          body: JSON.stringify(withConversation(name, args, extra._meta)),
          signal: AbortSignal.timeout(30000),
          redirect: "error",
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
server.registerTool(panel.name, panel.tool, (args, extra) =>
  panel.open(withConversation(panel.name, args, extra._meta)),
);
server.registerResource(panel.title, panel.uri, panel.resource, panel.read);
await server.connect(new StdioServerTransport());

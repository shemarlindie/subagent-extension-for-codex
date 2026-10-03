import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connectService } from "./launcher.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { definitions, withConversation } from "./tools.js";
import { type Control } from "./control.js";
import { withSettingsCapability } from "./settings.js";
import { delegationPanel, panelUri } from "./panel.js";
import { taskPanelContext } from "./panel-context.js";
import type { Task } from "./model.js";
import { codexContextCapability } from "./host-context.js";
const { token, origin } = await connectService();
const server = new McpServer(
  { name: "codex-subagent-extension", version: "0.1.0" },
  {
    instructions:
      "Use list_agent_projects and pass an explicit approved absolute repository to start_agent_task. current cannot identify the host chat project. Missing projects require registration with the local projects CLI.",
    capabilities: withSettingsCapability(codexContextCapability),
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
const panel = delegationPanel(
  resolve(dirname(fileURLToPath(import.meta.url)), "../dist/codex.html"),
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

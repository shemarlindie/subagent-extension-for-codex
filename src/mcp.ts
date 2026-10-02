import { McpServer, ProtocolError } from "@modelcontextprotocol/server";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { type Events, EventProtocolError } from "./events/service.js";
import { readFile } from "node:fs/promises";
import { definitions } from "./tools.js";
import { type Control } from "./control.js";
import { z } from "zod";
import { settingsCapability } from "./settings.js";
export function mcp(
  c: Control,
  owner: string,
  origin: string,
  htmlPath: string,
  events?: Events,
) {
  const server = new McpServer(
    { name: "codex-subagent-extension", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        extensions: settingsCapability,
        ...(events ? { events: {} } : {}),
      },
      requestState: { verify: (state) => c.forms.verify(owner, state) },
      instructions:
        "Use list_available_workers before delegation. Tasks run asynchronously in isolated worktrees. Inspect pending_input before submit_agent_input. Changes are returned as artifacts; applying them is a separate action.",
    },
  );
  server.registerTool(
    "request_agent_task",
    {
      description:
        "Ask the user to choose a worker, task and budgets using a host form, then delegate asynchronously. Use start_agent_task for clients without forms.",
      inputSchema: definitions(c, owner).start_agent_task.schema.extend({
        task: z.string().max(20000).optional(),
      }),
      annotations: { openWorldHint: true },
    },
    async (args, ctx) => {
      try {
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
    "request_agent_input",
    {
      description:
        "Present a task's pending question or permission request in a host form. The response is bound to that exact pending request. Use submit_agent_input for clients without forms.",
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
  for (const [name, d] of Object.entries(definitions(c, owner)))
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
          const result = await d.run(args);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: name.endsWith("_agent_settings")
              ? result
              : { result },
          };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text" as const, text: String(error) }],
          };
        }
      },
    );
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
  // Bump this URI when the widget metadata changes so hosts don't keep a
  // previously cached CSP for the old resource.
  const uri = "ui://codex-subagent-extension/app-v3";
  const resourceMeta = {
    ui: {
      csp: { connectDomains: [], resourceDomains: [] },
    },
    "openai/widgetCSP": {
      connect_domains: [],
      resource_domains: [],
    },
  };
  server.registerTool(
    "open_codex_subagent_extension",
    {
      description:
        "Open the extension interface using the host's authenticated MCP connection.",
      inputSchema: z.object({ conversation_id: z.string().optional() }),
      _meta: {
        ui: { resourceUri: uri },
        "openai/ui": { entrypoints: [{ type: "global" }, { type: "thread" }] },
      },
    },
    async (args) => ({
      content: [{ type: "text", text: "Subagent delegation is ready." }],
      structuredContent: {
        tasks: c.store
          .all(owner)
          .filter(
            (t) =>
              !args.conversation_id ||
              t.conversation_id === args.conversation_id,
          ),
      },
      _meta: {
        conversation_id: args.conversation_id,
      },
    }),
  );
  server.registerResource(
    "Codex subagent extension",
    uri,
    {
      description: "Task console",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: resourceMeta,
    },
    async () => ({
      contents: [
        {
          uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: (await readFile(htmlPath, "utf8")).replaceAll(
            "__API_ORIGIN__",
            origin,
          ),
          _meta: resourceMeta,
        },
      ],
    }),
  );
  return server;
}

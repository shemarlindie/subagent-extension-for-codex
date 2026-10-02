import type { OpenAIUiToolMetadata } from "@openai/mcp-extensions/server";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Task } from "./model.js";

// Bump the URI when resource metadata changes to invalidate host caches.
const uri = "ui://codex-subagent-extension/app-v4";
const entrypoints = {
  entrypoints: [{ type: "global" }, { type: "thread" }],
} satisfies OpenAIUiToolMetadata;
const resourceMeta = {
  ui: { csp: { connectDomains: [], resourceDomains: [] } },
  "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
};

export function delegationPanel(
  htmlPath: string,
  initialTasks?: (conversationId?: string) => Task[],
) {
  return {
    name: "open_codex_subagent_extension",
    uri,
    tool: {
      description:
        "Open the embedded delegation panel to inspect, start, steer, and review tasks. Pass conversation_id only when the conversation identity is known. Existing task tools remain usable without the panel.",
      inputSchema: z.object({ conversation_id: z.string().optional() }),
      outputSchema: z.object({
        conversation_id: z.string().optional(),
        panel_scope: z.object({ conversation_id: z.string().nullable() }),
        tasks: z.array(z.record(z.string(), z.unknown())).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: {
        ui: { resourceUri: uri },
        "openai/ui": entrypoints,
      },
    },
    open: async (args: { conversation_id?: string }) => ({
      content: [
        {
          type: "text" as const,
          text: "Delegation panel ready. Use list_agent_tasks to retrieve tasks.",
        },
      ],
      structuredContent: {
        ...args,
        panel_scope: { conversation_id: args.conversation_id ?? null },
        ...(initialTasks ? { tasks: initialTasks(args.conversation_id) } : {}),
      },
      _meta: { conversation_id: args.conversation_id },
    }),
    title: "Delegation panel",
    // The panel uses the authenticated bridge; no browser credentials are needed.
    resource: {
      description:
        "Embedded delegation panel using the portable MCP Apps bridge",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: resourceMeta,
    },
    read: async () => ({
      contents: [
        {
          uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readFile(htmlPath, "utf8"),
          _meta: resourceMeta,
        },
      ],
    }),
  };
}

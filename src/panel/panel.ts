import type {
  OpenAIUiToolMetadata,
  OpenAIUiResourceMetadata,
} from "@openai/mcp-extensions/server";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Task } from "../core/model.js";
import { panelContextInput, type PanelContextInput } from "./panel-context.js";

// Bump the URI when resource metadata changes to invalidate host caches.
export const panelUri = "ui://codex-subagent-extension/app-v6";
export const globalPanelToolName = "open_codex_subagent_extension_global";

const entrypoints = {
  entrypoints: [{ type: "thread" }],
  preferredModelDisplayMode: "inline",
} satisfies OpenAIUiToolMetadata;

const resourceMeta = {
  "openai/ui": {
    availableDisplayModes: ["inline", "fullscreen"],
    preferredDisplayMode: "inline",
  } satisfies OpenAIUiResourceMetadata,
  ui: { csp: { connectDomains: [], resourceDomains: [] } },
  "openai/widgetCSP": { connect_domains: [], resource_domains: [] },
};

type PanelContext = {
  panel_scope: {
    conversation_id: string | null;
    repository?: string;
    revision?: string;
  };
} & Record<string, unknown>;

export function delegationPanel(
  htmlPath: string,
  initialTasks?: (conversationId?: string) => Task[],
  context?: (args: PanelContextInput) => Promise<PanelContext>,
) {
  const panel = {
    name: "open_codex_subagent_extension",
    uri: panelUri,
    tool: {
      description:
        "Open Delegated work beside this chat when supported. Supply the actual approved repository and revision for first-use defaults, or task_id to activate an existing delegated task. Conversation correlation can be supplied by the host. Existing task tools remain usable without the panel.",
      title: "Delegated work",
      inputSchema: panelContextInput,
      outputSchema: z.object({
        conversation_id: z.string().nullable().optional(),
        panel_scope: z.object({
          conversation_id: z.string().nullable(),
          repository: z.string().optional(),
          revision: z.string().optional(),
        }),
        panel_project_candidate: z
          .object({ repository: z.string(), auto_register: z.boolean() })
          .optional(),
        panel_selection: z
          .object({ task_id: z.string(), tab: z.enum(["activity", "result"]) })
          .optional(),
        tasks: z.array(z.record(z.string(), z.unknown())).optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: {
        ui: { resourceUri: panelUri },
        "openai/ui": entrypoints,
      },
    },
    open: async (args: PanelContextInput) => {
      const resolved = context
        ? await context(args)
        : { panel_scope: { conversation_id: args.conversation_id ?? null } };

      return {
        content: [
          {
            type: "text" as const,
            text: "Delegation panel ready. Use list_agent_tasks to retrieve tasks.",
          },
        ],
        structuredContent: {
          conversation_id: resolved.panel_scope.conversation_id,
          ...resolved,
          ...(initialTasks
            ? {
                tasks: initialTasks(
                  resolved.panel_scope.conversation_id ?? undefined,
                ).filter(
                  (t) =>
                    !resolved.panel_scope.repository ||
                    t.repository === resolved.panel_scope.repository,
                ),
              }
            : {}),
        },
        _meta: { conversation_id: resolved.panel_scope.conversation_id },
      };
    },
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
          uri: panelUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readFile(htmlPath, "utf8"),
          _meta: resourceMeta,
        },
      ],
    }),
  };

  return {
    ...panel,
    // Global and thread entrypoints both launch with empty arguments. Give
    // global launches their own tool so ambient chat/cwd hints cannot scope it.
    global: {
      name: globalPanelToolName,
      tool: {
        ...panel.tool,
        description:
          "Open Delegated work across all projects and conversations.",
        inputSchema: z.strictObject({}),
        _meta: {
          ui: { resourceUri: panelUri, visibility: ["app"] },
          "openai/ui": {
            entrypoints: [{ type: "global" }],
            preferredModelDisplayMode: "inline",
          } satisfies OpenAIUiToolMetadata,
        },
      },
      open: () => panel.open({ conversation_id: null }),
    },
  };
}

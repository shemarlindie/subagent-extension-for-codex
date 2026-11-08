import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type {
  OpenAIUiResourceMetadata,
  OpenAIUiToolMetadata,
} from "@openai/mcp-extensions/server";
import { z } from "zod";

import { panelOutputSchema } from "../../../shared/panel/panel-contract.generated.js";
import type { PanelTask } from "../../../shared/tasks/task-list.js";
import type { TaskFilters } from "../../features/tasks/storage/task-rows.js";
import { productGlyphIcons } from "../server/product-glyph.js";
import { type PanelContextInput, panelContextInput } from "./panel-context.js";
import { preloadPanelHtml, readPanelHtml } from "./panel-html.js";

// Bump the URI when resource metadata or the panel's tool calls change, to
// invalidate host caches.
export const panelUri = "ui://subagent-extension-for-codex/app-v7";
const globalPanelToolName = "app_open_subagent_extension_for_codex_global";

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
  panel_selection?: { task_id: string };
} & Record<string, unknown>;

export function delegationPanel(
  htmlPath: string,
  initialTasks?: (filters: TaskFilters) => PanelTask[],
  context?: (args: PanelContextInput) => Promise<PanelContext>,
) {
  preloadPanelHtml(htmlPath);

  const panel = {
    name: "open_subagent_extension_for_codex",
    uri: panelUri,
    tool: {
      description:
        "Open the Delegated Work panel beside this chat when the host supports it. Pass task_id to show an existing task, or a registered repository and revision to prefill New task. Task tools work without the panel.",
      title: "Delegated Work",
      icons: productGlyphIcons,
      inputSchema: panelContextInput,
      outputSchema: panelOutputSchema,
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

      // A task the host opens stays listed even when it's archived.
      const selected = resolved.panel_selection?.task_id;

      return {
        content: [
          {
            type: "text" as const,
            text: "Delegated Work ready. Use list_tasks to retrieve tasks.",
          },
        ],
        structuredContent: {
          conversation_id: resolved.panel_scope.conversation_id,
          ...resolved,
          ...(initialTasks
            ? {
                tasks: initialTasks({
                  conversation:
                    resolved.panel_scope.conversation_id ?? undefined,
                  repository: resolved.panel_scope.repository,
                  archived: false,
                  include: selected ? [selected] : [],
                }),
              }
            : {}),
        },
        _meta: { conversation_id: resolved.panel_scope.conversation_id },
      };
    },
    title: "Delegated Work",
    // The panel uses the authenticated bridge; no browser credentials are needed.
    resource: {
      description:
        "Embedded Delegated Work app using the portable MCP Apps bridge",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: resourceMeta,
    },
    read: async () => ({
      contents: [
        {
          uri: panelUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readPanelHtml(htmlPath),
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
          "Open Delegated Work across all projects and conversations.",
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

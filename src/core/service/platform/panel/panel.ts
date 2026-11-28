import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { panelOutputSchema } from "../../../shared/panel/panel-contract.generated.js";
import type { PanelTaskList } from "../../../shared/tasks/task-list.js";
import type { TaskFilters } from "../../features/tasks/storage/task-rows.js";
import type { HostPanel } from "../host/host-adapter.js";
import { productGlyphIcons } from "../server/product-glyph.js";
import { panelContextInput, type PanelContextInput } from "./panel-context.js";
import { preloadPanelHtml, readPanelHtml } from "./panel-html.js";

type PanelContext = {
  panel_scope: {
    conversation_id: string | null;
    repository?: string;
    revision?: string;
  };
  panel_selection?: { task_id: string };
} & Record<string, unknown>;

/** The panel's tools and resource, named and annotated by the host. */
export function delegationPanel(
  host: HostPanel,
  htmlPath: string,
  initialTasks?: (filters: TaskFilters) => PanelTaskList,
  context?: (args: PanelContextInput) => Promise<PanelContext>,
) {
  preloadPanelHtml(htmlPath);

  const resourceMeta = {
    ui: { csp: { connectDomains: [], resourceDomains: [] } },
    ...host.resourceMeta,
  };

  const panel = {
    name: host.name,
    uri: host.uri,
    tool: {
      description:
        "Open the Delegated Work panel beside this chat when the host supports it. Pass task_id to show an existing task, or a registered repository and revision to prefill New task. Task tools work without the panel.",
      title: "Delegated Work",
      icons: productGlyphIcons,
      inputSchema: panelContextInput,
      outputSchema: panelOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: host.uri }, ...host.toolMeta },
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
            ? initialTasks({
                conversation: resolved.panel_scope.conversation_id ?? undefined,
                repository: resolved.panel_scope.repository,
                archived: "exclude",
                include: selected ? [selected] : [],
              })
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
          uri: host.uri,
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
      name: host.globalName,
      tool: {
        ...panel.tool,
        description:
          "Open Delegated Work across all projects and conversations.",
        inputSchema: z.strictObject({}),
        _meta: {
          ui: { resourceUri: host.uri, visibility: ["app"] },
          ...host.globalToolMeta,
        },
      },
      open: () => panel.open({ conversation_id: null }),
    },
  };
}

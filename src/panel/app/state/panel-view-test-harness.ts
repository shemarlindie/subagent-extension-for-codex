// Test-only view composition. The source-boundaries lint rule and the panel
// build reject production imports of `*-test-harness` modules.
import type { PanelView } from "./panel-view";

type ViewParts = {
  list: Record<string, unknown>;
  chat?: Record<string, unknown>;
  activity?: Record<string, unknown>;
  pending?: Record<string, unknown>;
};

/**
 * Answers an update wait's `view` from each part's own tool, as the service
 * builds it, so tests can hold or fail one part's read.
 */
export async function composeView(
  view: unknown,
  tool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) {
  const parts = view as ViewParts;

  const read = (name: string, args?: Record<string, unknown>) =>
    args ? tool(name, args) : undefined;

  const [projects, list, chat, activity, pending] = await Promise.all([
    tool("list_projects", {}),
    tool("app_list_tasks", parts.list),
    read("app_get_chat", parts.chat),
    read("app_get_activity", parts.activity),
    read("app_list_pending_updates", parts.pending),
  ]);

  return {
    built_at: Date.now(),
    projects,
    list,
    ...(chat === undefined ? {} : { chat }),
    ...(activity === undefined ? {} : { activity }),
    ...(pending === undefined ? {} : { pending }),
  } as PanelView;
}

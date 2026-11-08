// Test-only view composition. The source-boundaries lint rule and the panel
// build reject production imports of `*-test-harness` modules.
import type { PanelView } from "./panel-view";

type ViewParts = {
  list: Record<string, unknown>;
  chat?: Record<string, unknown>;
  activity?: Record<string, unknown>;
  pending?: Record<string, unknown>;
};

/** A part of a view, named as the view names it. */
type ViewPart = keyof Omit<PanelView, "built_at">;

/**
 * Answers an update wait's `view` from each requested part's own read, as
 * the service builds it, so tests can hold or fail one part's read.
 */
export async function composeView(
  view: unknown,
  read: (part: ViewPart, args: Record<string, unknown>) => unknown,
) {
  const parts = view as ViewParts;

  const optional = (part: ViewPart, args?: Record<string, unknown>) =>
    args ? read(part, args) : undefined;

  const [projects, list, chat, activity, pending] = await Promise.all([
    read("projects", {}),
    read("list", parts.list),
    optional("chat", parts.chat),
    optional("activity", parts.activity),
    optional("pending", parts.pending),
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

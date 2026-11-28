import type { PlanUsage } from "../../../src/core/shared/providers/plan-usage";
import {
  panelSettingsDefaults,
  type PanelSettings,
} from "../../../src/core/shared/settings/settings-schema";
import type { Draft } from "../../../src/core/shared/tasks/conversation/drafts";
import type { PanelView } from "../../../src/panel/app/state/panel-view";

type WaitRead = { revision: string; draft?: Draft | null };

type ViewParts = {
  list: Record<string, unknown>;
  chat?: Record<string, unknown>;
  activity?: Record<string, unknown>;
  pending?: Record<string, unknown>;
};

// Panel settings saved while the dev host page stays open. The plan usage
// meter starts on so the Plan usage host setting shows it.
let previewPanelSettings: PanelSettings = {
  ...panelSettingsDefaults,
  plan_usage_meter: true,
};

/** Saves a settings update, which fixtures allow only for panel settings. */
export function saveSettings(set: unknown) {
  const { panel, ...rest } = set as { panel?: Partial<PanelSettings> };

  if (!panel || Object.keys(rest).length) {
    throw new Error(
      "Design preview only. No worker or service action was executed.",
    );
  }

  previewPanelSettings = { ...previewPanelSettings, ...panel };

  return { values: { panel: previewPanelSettings } };
}

/** A part of a view, named as the view names it. */
export type ViewPart = keyof Omit<
  PanelView,
  "built_at" | "json_bytes" | "plan_usage"
>;

type PartRead = (part: ViewPart, args: Record<string, unknown>) => unknown;

/**
 * Builds the view an update wait asked for from each part's own read, as
 * `waitForUpdates` in `src/core/service/features/tasks/conversation/updates.ts`
 * does. Parts the wait didn't ask for are left out.
 */
function composeView(view: unknown, read: PartRead): PanelView {
  const parts = view as ViewParts;

  return {
    built_at: Date.now(),
    json_bytes: 0,
    settings: read("settings", {}),
    projects: read("projects", {}),
    list: read("list", parts.list),
    ...(parts.chat && { chat: read("chat", parts.chat) }),
    ...(parts.activity && { activity: read("activity", parts.activity) }),
    ...(parts.pending && { pending: read("pending", parts.pending) }),
  } as PanelView;
}

/**
 * Builds a view from part reads that may resolve later, so tests can hold
 * or fail one part's read.
 */
export async function composeHeldView(view: unknown, read: PartRead) {
  const parts = Object.entries(composeView(view, read));

  const held = Object.fromEntries(
    await Promise.all(
      parts.map(async ([part, value]) => [part, await Promise.resolve(value)]),
    ),
  ) as PanelView;

  // Timestamp the completed view, as the service does.
  return { ...held, built_at: Date.now() };
}

/**
 * Whether the wait should return without a view, as the service does when
 * only the target draft changed since `after`.
 */
function draftOnly(args: Record<string, unknown>, read: WaitRead) {
  const target = args.draft as
    { message_id?: string; after_length?: number } | undefined;

  const draftMoved =
    target &&
    (read.draft
      ? read.draft.message_id !== target.message_id ||
        read.draft.text.length > (target.after_length ?? 0)
      : target.message_id !== undefined);

  return args.after === read.revision && Boolean(draftMoved);
}

/** Adds the view an update wait asked for, built from each part's fixture read. */
export function withPreviewView(
  args: Record<string, unknown>,
  read: WaitRead,
  readPart: PartRead,
  planUsage?: PlanUsage,
) {
  if (draftOnly(args, read)) return read;

  const view = composeView(args.view, (part, partArgs) =>
    part === "settings" ? previewPanelSettings : readPart(part, partArgs),
  );

  return {
    ...read,
    view: { ...view, ...(planUsage && { plan_usage: planUsage }) },
  };
}

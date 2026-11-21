import type { PanelView } from "../../../src/panel/app/state/panel-view";
import type { PlanUsage } from "../../../src/shared/providers/plan-usage";
import {
  panelSettingsDefaults,
  type PanelSettings,
} from "../../../src/shared/settings/settings-schema";
import type { Draft } from "../../../src/shared/tasks/conversation/drafts";

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
  "built_at" | "settings" | "plan_usage"
>;

/**
 * Adds the view an update wait asked for, built from each part's fixture
 * read, as `waitForUpdates` in
 * `src/service/features/tasks/conversation/updates.ts` does. It leaves the
 * view out when only the target draft changed.
 */
export function withPreviewView(
  args: Record<string, unknown>,
  read: WaitRead,
  readPart: (part: ViewPart, args: Record<string, unknown>) => unknown,
  planUsage?: PlanUsage,
) {
  const view = args.view as ViewParts;

  const target = args.draft as
    { message_id?: string; after_length?: number } | undefined;

  const draftMoved =
    target &&
    (read.draft
      ? read.draft.message_id !== target.message_id ||
        read.draft.text.length > (target.after_length ?? 0)
      : target.message_id !== undefined);

  if (args.after === read.revision && draftMoved) return read;

  return {
    ...read,
    view: {
      built_at: Date.now(),
      settings: previewPanelSettings,
      ...(planUsage && { plan_usage: planUsage }),
      projects: readPart("projects", {}),
      list: readPart("list", view.list),
      ...(view.chat && { chat: readPart("chat", view.chat) }),
      ...(view.activity && { activity: readPart("activity", view.activity) }),
      ...(view.pending && { pending: readPart("pending", view.pending) }),
    },
  };
}

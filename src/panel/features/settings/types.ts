import type { SettingSection } from "../../../shared/settings/settings-document.js";
import type { ApprovalMode } from "../../../shared/tasks/model.js";

export type Defaults = {
  [key: string]: SettingValue | undefined;
  default_approval_mode?: ApprovalMode;
  default_model?: string;
  default_reasoning_effort?: string;
  [key: `${string}_default_model`]: string | undefined;
  [key: `${string}_default_reasoning_effort`]: string | undefined;
  default_workspace_strategy?: "worktree" | "current_repo";
  default_provider?: string;
  default_worker_profile?: string;
  max_runtime_minutes: number | null;
  use_runtime_budget?: boolean;
  max_cost_usd: number | null;
  use_cost_budget?: boolean;
};

export type SettingValue = string | number | boolean | null;

/**
 * `get_settings` as the dialog reads it: current values, the defaults a
 * reset restores, and the sections and rows to show. The JSON `schema` is for
 * agents; the dialog ignores it.
 */
export type SettingsDocument = {
  values: Record<string, SettingValue>;
  defaults: Record<string, SettingValue>;
  sections: SettingSection[];
};

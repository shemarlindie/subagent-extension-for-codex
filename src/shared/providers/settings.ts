import type { InputAuthority } from "../tasks/model.js";
import { claudeOverrideDefaults } from "./claude/permissions.js";
import {
  claudeApprovalRows,
  claudeRestrictionsSection,
  claudeSettingHelp,
  claudeSettingsShape,
  claudeStoredSettingsShape,
} from "./claude/settings.js";

/** Built-in registration point; saved keys remain stable when settings move. */
export const providerSettingHelp = { ...claudeSettingHelp };
export const providerApprovalRows = [...claudeApprovalRows];
export const providerRestrictionSections = [claudeRestrictionsSection];

export const preferredSettingsProvider = (providers: string[]) =>
  providers.includes("claude") ? "claude" : providers[0];

export const providerSettingsShape = { ...claudeSettingsShape };
export const providerStoredSettingsShape = { ...claudeStoredSettingsShape };

export const providerModelSettingScopes = ["claude", "fixture"] as const;

export function validateProviderSettingsUpdate(
  set: Record<string, unknown>,
  authority: InputAuthority,
) {
  if (authority === "user") return;
  if (
    set.claude_permission_mode !== undefined ||
    set.default_approval_decider !== undefined
  )
    throw new Error("Approval settings require a user decision in settings");
  if (Object.keys(claudeOverrideDefaults).some((key) => set[key] !== undefined))
    throw new Error(
      "Claude session restrictions require a user decision in settings",
    );
}

import type { SettingSection } from "../settings/document-contract.js";
import { inheritHelp, withClaudePolicy } from "./claude/settings-policy.js";
import {
  claudeApprovalRows,
  claudeRestrictionsSection,
  claudeSettingsSchema,
} from "./claude/settings.js";
import type { ProviderPolicy } from "./types.js";

/**
 * Built-in registration point. Each provider's settings block is saved under
 * `providers.<id>`, and its rows and sections join the settings document.
 */
export const providerSettingsSchemas = { claude: claudeSettingsSchema };
export const providerApprovalRows = [...claudeApprovalRows];
export const providerRestrictionSections = [claudeRestrictionsSection];

/** How a provider's org policy changes the settings document. */
interface ProviderSettingsPolicy {
  /** The sections with the policy's locks, warnings and facts applied. */
  apply: (
    sections: SettingSection[],
    policy: ProviderPolicy | undefined,
    values: unknown,
  ) => SettingSection[];
  /** What Inherit lands on after provider and profile settings. */
  inheritHelp: (
    policy: ProviderPolicy | undefined,
    runtime: { model?: string; effort?: string; modelReasons?: boolean },
  ) => string[];
}

export const providerSettingsPolicies: Partial<
  Record<string, ProviderSettingsPolicy>
> = { claude: { apply: withClaudePolicy, inheritHelp } };

export const preferredSettingsProvider = (providers: [string, ...string[]]) =>
  providers.includes("claude") ? "claude" : providers[0];

export const providerModelSettingScopes = ["claude", "fixture"] as const;

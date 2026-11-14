import {
  claudeApprovalRows,
  claudeRestrictionsSection,
  claudeSettingsSchema,
} from "./claude/settings.js";

/**
 * Built-in registration point. Each provider's settings block is saved under
 * `providers.<id>`, and its rows and sections join the settings document.
 */
export const providerSettingsSchemas = { claude: claudeSettingsSchema };
export const providerApprovalRows = [...claudeApprovalRows];
export const providerRestrictionSections = [claudeRestrictionsSection];

export const preferredSettingsProvider = (providers: [string, ...string[]]) =>
  providers.includes("claude") ? "claude" : providers[0];

export const providerModelSettingScopes = ["claude", "fixture"] as const;

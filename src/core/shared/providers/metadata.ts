import type { reasoningLevels } from "../tasks/reasoning.js";
import { providerDefinitions } from "./registry.js";

/** Serializable presentation contract for built-in providers; no SDK objects. */
export interface ProviderMetadata {
  displayName: string;
  /** CLI diagnostics offered in About. */
  cliName?: string;
  defaultEffortLevels?: (typeof reasoningLevels)[number][];
  costBudgetHelp?: string;
  nativePermissions?: {
    permissionOption: string;
    readOnlyMode?: string;
    /** The settings path of the saved native permission mode. */
    permissionSetting: string;
    approvalDeciderOption?: string;
    /** A Bash sandbox toggle: its task option, settings path and help. */
    sandbox?: { option: string; setting: string; help: string };
    options: { value: string; label: string; shortLabel?: string }[];
    formTitle?: string;
    formHelp?: string;
    help: string;
    approvalDecider: boolean;
    approvalDeciderHelp?: string;
  };
}

export const providerMetadata = (id: string, metadata?: ProviderMetadata) =>
  metadata ??
  providerDefinitions().find((definition) => definition.id === id)?.metadata;

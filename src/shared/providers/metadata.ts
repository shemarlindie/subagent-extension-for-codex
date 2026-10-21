import { reasoningLevels } from "../tasks/reasoning.js";
import {
  claudePermissionModes,
  permissionLabel,
} from "./claude/permissions.js";

/** Serializable presentation contract for built-in providers; no SDK objects. */
export interface ProviderMetadata {
  displayName: string;
  defaultEffortLevels?: (typeof reasoningLevels)[number][];
  costBudgetHelp?: string;
  nativePermissions?: {
    permissionOption: string;
    permissionSetting: string;
    approvalDeciderOption?: string;
    approvalDeciderSetting?: string;
    options: { value: string; label: string }[];
    formTitle?: string;
    formHelp?: string;
    help: string;
    approvalDecider: boolean;
    approvalDeciderHelp?: string;
  };
}

export const claudeMetadata: ProviderMetadata = {
  displayName: "Claude",
  defaultEffortLevels: reasoningLevels.filter(
    (level) => level !== "none" && level !== "minimal",
  ),
  costBudgetHelp:
    "Claude checks cost after a response. The budget may be exceeded; interrupted usage may be missing.",
  nativePermissions: {
    permissionOption: "permission_mode",
    permissionSetting: "claude_permission_mode",
    approvalDeciderOption: "approval_decider",
    approvalDeciderSetting: "default_approval_decider",
    formTitle: "Claude permission mode",
    formHelp:
      "Claude Code's permission mode for this task. Use extension setting follows your saved default.",
    options: [
      { value: "inherit", label: permissionLabel("inherit") },
      ...claudePermissionModes.map((value) => ({
        value,
        label: permissionLabel(value),
      })),
    ],
    help: "Claude Code's permission mode for this task. Use extension setting follows your saved default.",
    approvalDecider: true,
    approvalDeciderHelp:
      "Who answers permission requests that Claude Code doesn't decide itself.",
  },
};

export const fixtureMetadata: ProviderMetadata = {
  displayName: "Fixture",
};

/** Built-in presentation registration, including stored tasks without a live worker. */
export const builtinProviderMetadata: Partial<
  Record<string, ProviderMetadata>
> = {
  claude: claudeMetadata,
  fixture: fixtureMetadata,
};

export const providerMetadata = (id: string, metadata?: ProviderMetadata) =>
  metadata ?? builtinProviderMetadata[id];

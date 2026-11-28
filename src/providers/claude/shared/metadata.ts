import type { ProviderMetadata } from "../../../core/shared/providers/metadata.js";
import { reasoningLevels } from "../../../core/shared/tasks/reasoning.js";
import {
  claudePermissionModes,
  permissionLabel,
  permissionModeName,
} from "./permissions.js";

export const claudeMetadata = {
  displayName: "Claude",
  cliName: "Claude Code",
  defaultEffortLevels: reasoningLevels.filter(
    (level) => level !== "none" && level !== "minimal",
  ),
  costBudgetHelp:
    "Claude checks cost after a response. Usage may exceed the budget, and interrupted usage may be missing.",
  nativePermissions: {
    permissionOption: "permission_mode",
    readOnlyMode: "plan",
    permissionSetting: "providers.claude.permission_mode",
    approvalDeciderOption: "approval_decider",
    sandbox: {
      option: "sandbox",
      setting: "providers.claude.sandbox",
      help: "Runs this task's Bash commands in Claude Code's sandbox. Starts from your setting.",
    },
    formTitle: "Claude permission mode",
    formHelp:
      'Claude Code\'s permission mode. "Use extension setting" uses your saved default.',
    options: [
      {
        value: "inherit",
        label: permissionLabel("inherit"),
        shortLabel: permissionModeName("inherit"),
      },
      ...claudePermissionModes.map((value) => ({
        value,
        label: permissionLabel(value),
        shortLabel: permissionModeName(value),
      })),
    ],
    help: 'Claude Code\'s permission mode. "Use extension setting" uses your saved default.',
    approvalDecider: true,
    approvalDeciderHelp:
      "Who answers permission requests that Claude Code doesn't decide itself.",
  },
} satisfies ProviderMetadata;

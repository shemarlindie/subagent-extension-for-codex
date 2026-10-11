import {
  claudeMetadata,
  fixtureMetadata,
  type ProviderMetadata,
} from "../../src/shared/providers/metadata.js";
import type { ModelChoice } from "../../src/shared/providers/types.js";

export const fixtureModels: ModelChoice[] = [
  {
    value: "fixture-default",
    displayName: "Fixture Default",
    description: "Deterministic fake model for provider and panel scenarios.",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "fixture-fast",
    displayName: "Fixture Fast",
    description: "A fake model that does not expose reasoning effort.",
    supportsEffort: false,
  },
];

export const fixtureProviderCapabilities = {
  interrupt: true,
  session_continue: true,
  session_state_portable: false,
  interactive_input: true,
  worktree: true,
  cost_budget: true,
  runtime_budget: true,
  token_budget: false,
  subagents: true,
  parallel_subagents: true,
  dynamic_subagents: false,
};

const fixtureEffortLevels: ProviderMetadata["defaultEffortLevels"] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const fixturePermissionModes = claudeMetadata.nativePermissions!;

const fixtureProviderMetadata: ProviderMetadata = {
  ...fixtureMetadata,
  defaultEffortLevels: fixtureEffortLevels,
  costBudgetHelp:
    "Fixture costs are deterministic and exist only to exercise budget presentation.",
  nativePermissions: {
    ...fixturePermissionModes,
    formTitle: "Fixture permission mode",
    formHelp:
      "Controls synthetic fixture approval outcomes. No tools execute and no host isolation is applied.",
    help: "Select simulated permission behavior for fixture scenarios. This does not execute Claude or apply host security.",
    approvalDeciderHelp:
      "Choose who can answer simulated fixture permission requests.",
  },
};

export function createFixtureProviderMetadata(): ProviderMetadata {
  return {
    ...fixtureProviderMetadata,
    ...(fixtureProviderMetadata.defaultEffortLevels
      ? {
          defaultEffortLevels: [...fixtureProviderMetadata.defaultEffortLevels],
        }
      : {}),
    ...(fixtureProviderMetadata.nativePermissions
      ? {
          nativePermissions: {
            ...fixtureProviderMetadata.nativePermissions,
            options: fixtureProviderMetadata.nativePermissions.options.map(
              (option) => ({ ...option }),
            ),
          },
        }
      : {}),
  };
}

export function cloneFixtureModel(model: ModelChoice): ModelChoice {
  return {
    ...model,
    ...(model.supportedEffortLevels
      ? { supportedEffortLevels: [...model.supportedEffortLevels] }
      : {}),
  };
}

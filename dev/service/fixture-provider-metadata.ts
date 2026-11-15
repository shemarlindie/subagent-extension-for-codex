import {
  claudeMetadata,
  fixtureMetadata,
  type ProviderMetadata,
} from "../../src/shared/providers/metadata.js";
import type {
  ModelChoice,
  ProviderCommand,
} from "../../src/shared/providers/types.js";

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
    description: "A fake model that does not expose reasoning options.",
    supportsEffort: false,
  },
];

/** Commands like Claude Code's, including ones tasks refuse. */
export const fixtureCommands: ProviderCommand[] = [
  {
    name: "clear",
    description: "Start a new session with empty context",
    argument_hint: "",
    aliases: ["reset", "new"],
    builtin: true,
  },
  {
    name: "color",
    description: "Set the prompt bar color for this session",
    argument_hint: "[color]",
    aliases: [],
    builtin: true,
  },
  {
    name: "compact",
    description: "Clear conversation history but keep a summary in context",
    argument_hint: "<optional custom summarization instructions>",
    aliases: [],
    builtin: true,
  },
  {
    name: "context",
    description: "Show current context usage",
    argument_hint: "",
    aliases: [],
    builtin: true,
  },
  {
    name: "model",
    description: "Set the AI model for Claude Code",
    argument_hint: "[model]",
    aliases: [],
    builtin: true,
  },
  {
    name: "review-plan",
    description: "Review the project plan against the code",
    argument_hint: "<plan file>",
    aliases: [],
    builtin: false,
  },
  {
    name: "usage",
    description: "Show plan usage limits",
    argument_hint: "",
    aliases: ["cost"],
    builtin: true,
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
  slash_commands: true,
};

const fixtureEffortLevels: ProviderMetadata["defaultEffortLevels"] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const fixturePermissionModes = claudeMetadata.nativePermissions;

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

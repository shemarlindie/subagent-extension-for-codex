import { modelAllowed } from "../../../src/shared/providers/policy";
import type {
  ModelChoice,
  ProviderPolicy,
} from "../../../src/shared/providers/types";

const previewModels: [ModelChoice, ...ModelChoice[]] = [
  {
    value: "default",
    displayName: "Default (recommended)",
    description: "Opus 5.5 · Best for everyday, complex tasks",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "opus",
    resolvedModel: "claude-opus-5-5",
    displayName: "Opus 5.5",
    description: "For complex work and everyday tasks",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-5-5",
    displayName: "Sonnet 5.5",
    description: "Most efficient for simpler tasks",
    supportedEffortLevels: ["low", "medium", "high"],
  },
  {
    value: "haiku",
    resolvedModel: "claude-haiku-4-5",
    displayName: "Haiku 4.5",
    description: "Fastest for quick answers",
    supportsEffort: false,
  },
];

/**
 * Policy as discovery reports it, with a lock the extension can't apply. The
 * dev host offers it as an example to edit.
 */
export const previewOrgPolicy: ProviderPolicy = {
  managed: true,
  source: "console",
  blocked: [
    {
      value: "auto",
      reason: "Turned off by your organization",
    },
    {
      value: "bypassPermissions",
      reason: "Turned off by your organization",
    },
  ],
  available_models: ["sonnet", "haiku"],
  available_models_match: "prefix",
  default_model: { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
  default_effort: "low",
  max_effort: "medium",
  prompts_denied: true,
  notes: [{ label: "Hooks", detail: "Only your organization's hooks run." }],
};

/** Default as discovery reports it, naming the org's default model. */
function orgDefault({ default_model }: ProviderPolicy): ModelChoice {
  const plain = previewModels[0];

  if (!default_model) return plain;

  const runs = previewModels.find(
    ({ resolvedModel }) => resolvedModel === default_model.id,
  );

  return {
    ...plain,
    resolvedModel: default_model.id,
    description: `Use the default model (currently ${default_model.name}) · Set by your organization`,
    supportedEffortLevels: runs?.supportedEffortLevels,
    supportsEffort: runs?.supportsEffort,
  };
}

/** What discovery reports for a worker, with the policy's allowlist applied. */
export const previewCatalog = (policy?: ProviderPolicy) =>
  policy
    ? {
        models: [
          orgDefault(policy),
          ...previewModels.filter(
            ({ value, resolvedModel = value }) =>
              value !== "default" &&
              (modelAllowed(policy, [], value) ||
                modelAllowed(policy, [], resolvedModel)),
          ),
        ],
        policy,
      }
    : { models: previewModels };

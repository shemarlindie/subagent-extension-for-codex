import type {
  ModelChoice,
  ProviderPolicy,
} from "../../../src/shared/providers/types";

const previewModels: ModelChoice[] = [
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
    displayName: "Haiku 4.5",
    description: "Fastest for quick answers",
    supportsEffort: false,
  },
];

/** Policy as discovery reports it, with a lock the extension can't apply. */
const previewOrgPolicy = (
  source: NonNullable<ProviderPolicy["source"]>,
): ProviderPolicy => ({
  managed: true,
  source,
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
});

/** Default as discovery reports it under the org's default model. */
const previewOrgDefault: ModelChoice = {
  value: "default",
  resolvedModel: "claude-sonnet-5-5",
  displayName: "Default (recommended)",
  description:
    "Use the default model (currently Sonnet 5.5) · Set by your organization",
  supportedEffortLevels: ["low", "medium", "high"],
};

/** What discovery reports for a worker, with an allowlist narrowing the models. */
export const previewCatalog = (source?: ProviderPolicy["source"]) =>
  source
    ? {
        models: [
          previewOrgDefault,
          ...previewModels.filter(({ value }) =>
            ["sonnet", "haiku"].includes(value),
          ),
        ],
        policy: previewOrgPolicy(source),
      }
    : { models: previewModels };

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
    displayName: "Opus 5.5",
    description: "For complex work and everyday tasks",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    value: "sonnet",
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
      setting: "permission_mode",
      value: "auto",
      reason: "Turned off by your organization",
    },
    {
      setting: "permission_mode",
      value: "bypassPermissions",
      reason: "Turned off by your organization",
    },
    {
      setting: "sandbox",
      value: "extension",
      reason: "Your organization turned off the sandbox",
    },
    {
      setting: "sandbox",
      value: "extension_locked",
      reason: "Your organization turned off the sandbox",
    },
  ],
  available_models: ["sonnet", "haiku"],
  available_models_match: "prefix",
  notes: [{ label: "Hooks", detail: "Only your organization's hooks run." }],
});

/** What discovery reports for a worker, with an allowlist narrowing the models. */
export const previewCatalog = (source?: ProviderPolicy["source"]) =>
  source
    ? {
        models: previewModels.filter(({ value }) =>
          ["sonnet", "haiku"].includes(value),
        ),
        policy: previewOrgPolicy(source),
      }
    : { models: previewModels };

import type {
  ModelScope,
  SettingRow,
  SettingSection,
} from "../../settings/document-contract.js";
import { settingAt } from "../../settings/settings-schema.js";
import { titleCase } from "../../text.js";
import { blockedReason, withBlockedOptions } from "../policy.js";
import type { ProviderPolicy } from "../types.js";
import { MODE_TURNED_OFF_BY_ORG, permissionModeName } from "./permissions.js";
import { claudeRestrictionsSection } from "./settings.js";

const PROMPTS_DENIED =
  "Your organization denies tool calls that would ask for approval, and Claude can't ask questions.";

/**
 * The mode row with modes policy rules out locked, and a warning if it's the
 * saved one. The approval decider row warns when nobody is asked.
 */
function withPolicy(
  row: SettingRow,
  policy: ProviderPolicy,
  values: unknown,
): SettingRow {
  if (row.kind !== "select") return row;

  if (row.path === "approvals.decider") {
    return policy.prompts_denied ? { ...row, warning: PROMPTS_DENIED } : row;
  }

  if (row.path !== "providers.claude.permission_mode") return row;

  const saved = String(settingAt(values, row.path));
  const reason = blockedReason(policy, saved);

  return {
    ...row,
    options: withBlockedOptions(row.options, policy),
    ...(reason
      ? {
          warning:
            reason === MODE_TURNED_OFF_BY_ORG
              ? "Your organization turned off this mode. New tasks ask for approval."
              : "This mode isn't available. New tasks ask for approval.",
        }
      : {}),
  };
}

/** The runtime defaults inherited after provider and profile settings. */
export function inheritHelp(policy: ProviderPolicy | undefined): string[] {
  const model = policy?.default_model?.name;
  const effort = policy?.default_effort && titleCase(policy.default_effort);

  if (model && effort) {
    return [`your organization's default, ${model} with ${effort} reasoning.`];
  }

  if (model) {
    return [
      `your organization's default model, ${model}, and the worker's own reasoning.`,
    ];
  }

  if (effort) {
    return [
      `the worker's own model and your organization's default reasoning, ${effort}.`,
    ];
  }

  return ["the worker's own default. This applies to model and reasoning."];
}

/** Claude's Inherit names the organization's default model. */
function withOrgDefaults(
  scope: ModelScope,
  policy: ProviderPolicy,
): ModelScope {
  if (scope.id !== "claude" || !policy.default_model) return scope;

  return {
    ...scope,
    model: {
      ...scope.model,
      options: scope.model.options?.map((option) =>
        option.value === ""
          ? { ...option, label: `Inherit (${policy.default_model!.name})` }
          : option,
      ),
    },
  };
}

const SOURCE_HELP = {
  console: "Your organization's admin console sets these limits.",
  device: "A policy on this computer sets these limits.",
};

/** What the panel shows about an organization's policy. */
function policyFacts(policy: ProviderPolicy) {
  const modes = policy.blocked
    .filter(({ reason }) => reason === MODE_TURNED_OFF_BY_ORG)
    .map(({ value }) => permissionModeName(value));

  return [
    ...(policy.default_model
      ? [{ label: "Default model", detail: `${policy.default_model.name}.` }]
      : []),
    ...(defaultReasoning(policy)
      ? [{ label: "Default reasoning", detail: defaultReasoning(policy)! }]
      : []),
    ...(modes.length
      ? [
          {
            label: "Permission modes",
            detail: `Turned off: ${modes.join(", ")}.`,
          },
        ]
      : []),
    ...(policy.available_models
      ? [
          {
            label: "Models",
            detail: policy.available_models.length
              ? `Limited to ${policy.available_models.join(", ")}.`
              : "Limited to the default model.",
          },
        ]
      : []),
    ...(reasoningLimit(policy)
      ? [{ label: "Reasoning", detail: reasoningLimit(policy)! }]
      : []),
    ...(policy.prompts_denied
      ? [
          {
            label: "Approvals",
            detail:
              "Tool calls that would ask for approval are denied, and Claude can't ask questions.",
          },
        ]
      : []),
    ...policy.notes,
  ];
}

/** The org's default reasoning in words, such as "Medium, and Low for sonnet." */
function defaultReasoning({
  default_effort,
  model_default_effort,
}: ProviderPolicy) {
  const parts = [
    ...(default_effort ? [titleCase(default_effort)] : []),
    ...Object.entries(model_default_effort ?? {}).map(
      ([model, level]) => `${titleCase(level)} for ${model}`,
    ),
  ];

  return parts.length
    ? `${parts[0]}${parts.length > 1 ? `, and ${parts.slice(1).join(", ")}` : ""}.`
    : undefined;
}

/** The org's reasoning caps in words, such as "Limited to High, and Low for opus." */
function reasoningLimit({ max_effort, model_max_effort }: ProviderPolicy) {
  const all = max_effort && max_effort !== "max" ? titleCase(max_effort) : "";

  // A model's `max` only lifts a top-level cap.
  const own = Object.entries(model_max_effort ?? {})
    .filter(([, level]) => all || level !== "max")
    .map(([model, level]) =>
      level === "max"
        ? `no limit for ${model}`
        : `${titleCase(level)} for ${model}`,
    );

  if (!all) return own.length ? `Limited to ${own.join(", ")}.` : undefined;

  return own.length
    ? `Limited to ${all}, and ${own.join(", ")}.`
    : `Limited to ${all}.`;
}

/** Settings sections with Claude's org policy applied. */
export function withClaudePolicy(
  sections: SettingSection[],
  policy: ProviderPolicy | undefined,
  values: unknown,
) {
  if (!policy) return sections;

  const applied = sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) =>
      row.kind === "models"
        ? {
            ...row,
            scopes: row.scopes.map((scope) => withOrgDefaults(scope, policy)),
          }
        : withPolicy(row, policy, values),
    ),
  }));

  if (!policy.managed) return applied;

  const after = applied.findIndex(
    ({ id }) => id === claudeRestrictionsSection.id,
  );

  applied.splice(after + 1, 0, {
    id: "organization-policy",
    title: "Organization policy",
    help: [
      `${policy.source ? SOURCE_HELP[policy.source] : "Your organization sets these limits."} Claude Code enforces them, along with any others your organization sets.`,
    ],
    facts: policyFacts(policy),
    rows: [],
  });

  return applied;
}

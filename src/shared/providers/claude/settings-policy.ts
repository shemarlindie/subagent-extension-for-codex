import type {
  ModelScope,
  SettingRow,
  SettingSection,
} from "../../settings/document-contract.js";
import { settingAt } from "../../settings/settings-schema.js";
import { roles } from "../../tasks/model.js";
import { scalarText, titleCase } from "../../text.js";
import { blockedReason, resolvedModel, withBlockedOptions } from "../policy.js";
import type { ModelChoice, ProviderPolicy } from "../types.js";
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
              ? `Your saved mode, ${permissionModeName(saved)}, is turned off by your organization. New tasks ask for approval.`
              : `Your saved mode, ${permissionModeName(saved)}, isn't available. New tasks ask for approval.`,
        }
      : {}),
  };
}

/** Why a section's locked fields show the org's defaults, said once. */
function orgDefaultsHelp({ default_model, default_effort }: ProviderPolicy) {
  if (!default_model && !default_effort) return undefined;

  const effort = default_effort && titleCase(default_effort);

  const model = default_model?.name;
  let defaults = `default model is ${model}`;

  if (!model) defaults = `default reasoning is ${effort}`;
  else if (effort) defaults = `default is ${model} with ${effort} reasoning`;

  return ` Your organization's ${defaults}. To change it for one task, use the composer.`;
}

const savedWarning = (what: string, name: string) =>
  `Your saved ${what}, ${name}, applies again if your organization stops setting a default.`;

/**
 * A model scope with the org's defaults in place of the choices they
 * outrank. A saved value that differs stays, with a warning. Other
 * providers' rows keep their own defaults.
 */
function withOrgDefaultLocks(
  scope: ModelScope,
  { default_model: model, default_effort: effort }: ProviderPolicy,
  models: readonly ModelChoice[],
  values: unknown,
): ModelScope {
  if (!["global", "claude", ...roles].includes(scope.id)) return scope;

  const savedModel = scalarText(settingAt(values, scope.model.path));
  const savedEffort = scalarText(settingAt(values, scope.effort.path));

  const modelName =
    scope.model.options?.find(({ value }) => value === savedModel)?.label ??
    savedModel;

  const modelDiffers =
    !!savedModel && resolvedModel(models, savedModel) !== model?.id;

  const effortDiffers =
    !!savedEffort && savedEffort !== "default" && savedEffort !== effort;

  return {
    ...scope,
    model: model
      ? {
          ...scope.model,
          locked: model.name,
          warning: modelDiffers ? savedWarning("model", modelName) : undefined,
        }
      : scope.model,
    effort: effort
      ? {
          ...scope.effort,
          locked: titleCase(effort),
          unsupported: false,
          warning: effortDiffers
            ? savedWarning("reasoning", titleCase(savedEffort))
            : undefined,
        }
      : scope.effort,
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
    ...(policy.default_effort
      ? [
          {
            label: "Default reasoning",
            detail: `${titleCase(policy.default_effort)}.`,
          },
        ]
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
  catalog: { policy?: ProviderPolicy; models?: ModelChoice[] } | undefined,
  values: unknown,
) {
  const policy = catalog?.policy;
  const models = catalog?.models ?? [];

  if (!policy) return sections;

  const lockHelp = orgDefaultsHelp(policy);

  const applied = sections.map((section) => {
    const hasModels = section.rows.some(({ kind }) => kind === "models");

    return {
      ...section,
      ...(hasModels && lockHelp
        ? { help: [...(section.help ?? []), lockHelp] }
        : {}),
      rows: section.rows.map((row) =>
        row.kind === "models"
          ? {
              ...row,
              scopes: row.scopes.map((scope) =>
                withOrgDefaultLocks(scope, policy, models, values),
              ),
            }
          : withPolicy(row, policy, values),
      ),
    };
  });

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

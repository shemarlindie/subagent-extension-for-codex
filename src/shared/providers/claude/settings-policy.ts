import type {
  ModelScope,
  SettingRow,
  SettingSection,
} from "../../settings/document-contract.js";
import { settingAt } from "../../settings/settings-schema.js";
import { roles } from "../../tasks/model.js";
import { scalarText, titleCase } from "../../text.js";
import { blockedReason, withBlockedOptions } from "../policy.js";
import type { ProviderPolicy } from "../types.js";
import { MODE_TURNED_OFF_BY_ORG, permissionModeName } from "./permissions.js";
import { claudeRestrictionsSection } from "./settings.js";

/** The mode row with modes policy rules out locked, and a warning if it's the saved one. */
function withPolicy(
  row: SettingRow,
  policy: ProviderPolicy,
  values: unknown,
): SettingRow {
  if (
    row.kind !== "select" ||
    row.path !== "providers.claude.permission_mode"
  ) {
    return row;
  }

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

  let defaults = `default model is ${default_model}`;

  if (!default_model) defaults = `default reasoning is ${effort}`;
  else if (effort)
    defaults = `default is ${default_model} with ${effort} reasoning`;

  return ` Your organization's ${defaults}. To change it for one task, use the composer.`;
}

const savedWarning = (what: string, name: string) =>
  `Your saved ${what}, ${name}, applies again if your organization stops setting a default.`;

/**
 * A model scope with the org's defaults in place of the choices they
 * outrank. Saved values stay, with a warning. Other providers' rows keep
 * their own defaults.
 */
function withOrgDefaultLocks(
  scope: ModelScope,
  { default_model: model, default_effort: effort }: ProviderPolicy,
  values: unknown,
): ModelScope {
  if (!["global", "claude", ...roles].includes(scope.id)) return scope;

  const savedModel = scalarText(settingAt(values, scope.model.path));
  const savedEffort = scalarText(settingAt(values, scope.effort.path));

  const modelName =
    scope.model.options?.find(({ value }) => value === savedModel)?.label ??
    savedModel;

  return {
    ...scope,
    model: model
      ? {
          ...scope.model,
          locked: model,
          warning: savedModel ? savedWarning("model", modelName) : undefined,
        }
      : scope.model,
    effort: effort
      ? {
          ...scope.effort,
          locked: titleCase(effort),
          unsupported: false,
          warning:
            savedEffort && savedEffort !== "default"
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
      ? [{ label: "Default model", detail: `${policy.default_model}.` }]
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
    ...policy.notes,
  ];
}

/** Settings sections with Claude's org policy applied. */
export function withClaudePolicy(
  sections: SettingSection[],
  policy: ProviderPolicy | undefined,
  values: unknown,
) {
  if (!policy) return sections;

  const lockHelp = orgDefaultsHelp(policy);

  const applied = sections.map((section) => {
    const models = section.rows.some(({ kind }) => kind === "models");

    return {
      ...section,
      ...(models && lockHelp
        ? { help: [...(section.help ?? []), lockHelp] }
        : {}),
      rows: section.rows.map((row) =>
        row.kind === "models"
          ? {
              ...row,
              scopes: row.scopes.map((scope) =>
                withOrgDefaultLocks(scope, policy, values),
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

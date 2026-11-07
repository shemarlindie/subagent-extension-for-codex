import type {
  SettingRow,
  SettingSection,
} from "../../settings/document-contract.js";
import { settingAt } from "../../settings/settings-schema.js";
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

  const applied = sections.map((section) => ({
    ...section,
    rows: section.rows.map((row) => withPolicy(row, policy, values)),
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

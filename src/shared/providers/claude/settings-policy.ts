import type {
  SettingRow,
  SettingSection,
} from "../../settings/document-contract.js";
import { settingAt } from "../../settings/settings-schema.js";
import { blockedReason, withBlockedOptions } from "../policy.js";
import type { ProviderPolicy } from "../types.js";
import { MODE_TURNED_OFF_BY_ORG, permissionModeName } from "./permissions.js";
import { claudeRestrictionsSection } from "./settings.js";

/** A row with what policy rules out locked, and a warning if it's the saved choice. */
function withPolicy(
  row: SettingRow,
  policy: ProviderPolicy,
  values: unknown,
): SettingRow {
  if (row.kind !== "select") return row;

  const saved = String(settingAt(values, row.path));

  const lock = (
    setting: ProviderPolicy["blocked"][number]["setting"],
    warning: (reason: string) => string,
  ) => {
    const reason = blockedReason(policy, setting, saved);

    return {
      ...row,
      options: withBlockedOptions(row.options, policy, setting),
      ...(reason ? { warning: warning(reason) } : {}),
    };
  };

  if (row.path === "providers.claude.permission_mode") {
    return lock("permission_mode", (reason) =>
      reason === MODE_TURNED_OFF_BY_ORG
        ? `Your saved mode, ${permissionModeName(saved)}, is turned off by your organization. New tasks ask for approval.`
        : `Your saved mode, ${permissionModeName(saved)}, isn't available. New tasks ask for approval.`,
    );
  }

  if (row.path === "providers.claude.sandbox") {
    return lock(
      "sandbox",
      (reason) =>
        `${reason}, so tasks can't start with your saved choice. Choose another option or ask your admin.`,
    );
  }

  return row;
}

const SOURCE_HELP = {
  console: "Your organization's admin console sets these limits.",
  device: "A policy on this computer sets these limits.",
};

/** What the panel shows about an organization's policy. */
function policyFacts(policy: ProviderPolicy) {
  const blocked = (setting: ProviderPolicy["blocked"][number]["setting"]) =>
    policy.blocked.filter((item) => item.setting === setting);

  const modes = blocked("permission_mode")
    .filter(({ reason }) => reason === MODE_TURNED_OFF_BY_ORG)
    .map(({ value }) => permissionModeName(value));

  const sandbox = [...new Set(blocked("sandbox").map(({ reason }) => reason))];

  return [
    ...(modes.length
      ? [
          {
            label: "Permission modes",
            detail: `Turned off: ${modes.join(", ")}.`,
          },
        ]
      : []),
    ...sandbox.map((reason) => ({
      label: "Bash sandbox",
      detail: `${reason}.`,
    })),
    ...(policy.available_models
      ? [
          {
            label: "Models",
            detail: `Limited to ${policy.available_models.join(", ")}.`,
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

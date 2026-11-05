import type { ModelChoice, ProviderPolicy } from "./types.js";

const FAMILY_ALIASES = ["opus", "sonnet", "haiku", "fable"];

function entryAllows(entry: string, model: string, exact: boolean) {
  if (model === entry) return true;
  if (FAMILY_ALIASES.includes(entry)) return model.includes(`-${entry}-`);
  if (!model.startsWith(entry)) return false;

  // An exact entry still covers its dated and fast IDs.
  return !exact || /^(-\d{8}|-fast)+$/.test(model.slice(entry.length));
}

/**
 * Whether a typed model fits an allowlist. Claude Code lets an excluded model
 * run when a task names it, so the extension has to check. Its matching is
 * simpler than the CLI's, so an older ID of an allowed family may be refused,
 * and an alias still works.
 */
export function modelAllowed(
  policy: ProviderPolicy | undefined,
  models: readonly ModelChoice[],
  value: string,
) {
  const entries = policy?.available_models;
  const exact = policy?.available_models_match === "exact";
  const model = value.replace(/\[.*\]$/, "");

  if (!entries || !model || model === "default") return true;

  return (
    models.some(
      (choice) => choice.value === model || choice.resolvedModel === model,
    ) || entries.some((entry) => entryAllows(entry, model, exact))
  );
}

/** Why policy rules out a choice for a setting, if it does. */
export const blockedReason = (
  policy: ProviderPolicy | undefined,
  setting: ProviderPolicy["blocked"][number]["setting"],
  value: string,
) =>
  policy?.blocked.find(
    (item) => item.setting === setting && item.value === value,
  )?.reason;

/** A setting's choices, with those policy rules out locked and explained. */
export function withBlockedOptions<O extends { value: string }>(
  options: O[],
  policy: ProviderPolicy | undefined,
  setting: ProviderPolicy["blocked"][number]["setting"],
) {
  return options.map((option) => {
    const reason = blockedReason(policy, setting, option.value);

    return reason ? { ...option, disabled: true, description: reason } : option;
  });
}

/**
 * The mode a new task can use: a blocked one reads as the mode Claude Code
 * would fall back to, so a form never shows or submits what can't run.
 */
export const allowedPermissionMode = (
  policy: ProviderPolicy | undefined,
  mode: string,
) => (blockedReason(policy, "permission_mode", mode) ? "default" : mode);

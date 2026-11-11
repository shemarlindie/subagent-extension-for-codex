import { reasoningLevels } from "../tasks/reasoning.js";
import { titleCase } from "../text.js";
import type { ModelChoice, ProviderPolicy } from "./types.js";

export const FAMILY_ALIASES = ["opus", "sonnet", "haiku", "fable"];

/** Whether an ID is a dated or fast form of another. */
export const isModelVariant = (model: string, base: string) =>
  model.startsWith(base) && /^(-\d{8}|-fast)+$/.test(model.slice(base.length));

function entryAllows(entry: string, model: string, exact: boolean) {
  if (model === entry) return true;
  if (FAMILY_ALIASES.includes(entry)) return model.includes(`-${entry}-`);
  if (!model.startsWith(entry)) return false;

  // An exact entry still covers its dated and fast IDs.
  return !exact || isModelVariant(model, entry);
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
      (choice) =>
        choice.value === value ||
        choice.value === model ||
        choice.resolvedModel === model,
    ) || entries.some((entry) => entryAllows(entry, model, exact))
  );
}

/** The model ID a choice runs, from the catalog. Blank runs Default. */
export const resolvedModel = (models: readonly ModelChoice[], value = "") =>
  models.find((choice) => choice.value === (value || "default"))
    ?.resolvedModel ?? value;

/**
 * The highest reasoning policy allows for a model ID, if it limits it. A
 * model's own cap replaces the top-level one, and `max` means no limit.
 */
export function effortCap(policy: ProviderPolicy | undefined, model: string) {
  const id = model.replace(/\[.*\]$/, "");

  const own = Object.entries(policy?.model_max_effort ?? {}).find(([key]) =>
    entryAllows(key, id, true),
  )?.[1];

  const cap = own ?? policy?.max_effort;

  return cap === "max" ? undefined : cap;
}

const rank = (level: string) =>
  reasoningLevels.indexOf(level as (typeof reasoningLevels)[number]);

/** Whether a level is above a cap. Default inherits, so it never is. */
export const aboveEffortCap = (level: string, cap: string | undefined) =>
  !!cap && rank(level) > rank(cap);

export const effortCapReason = (cap: string) =>
  `Your organization limits reasoning to ${titleCase(cap)}.`;

/** Reasoning choices, with those above the cap locked and explained. */
export function withEffortCap<O extends { value: string }>(
  options: O[],
  cap: string | undefined,
) {
  return options.map((option) =>
    cap && aboveEffortCap(option.value, cap)
      ? { ...option, disabled: true, description: effortCapReason(cap) }
      : option,
  );
}

/** Why policy rules out a permission mode, if it does. */
export const blockedReason = (
  policy: ProviderPolicy | undefined,
  mode: string,
) => policy?.blocked.find((item) => item.value === mode)?.reason;

/** Permission mode choices, with those policy rules out locked and explained. */
export function withBlockedOptions<O extends { value: string }>(
  options: O[],
  policy: ProviderPolicy | undefined,
) {
  return options.map((option) => {
    const reason = blockedReason(policy, option.value);

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
) => (blockedReason(policy, mode) ? "default" : mode);

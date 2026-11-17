import type { ModelChoice } from "../../../shared/providers/types";
import { titleCase } from "../../../shared/text";

/**
 * A model's display name, by its value or the full ID an alias stands for,
 * falling back to the ID for undiscovered models.
 */
export function modelName(models: readonly ModelChoice[], value: string) {
  const match =
    models.find((model) => model.value === value) ??
    models.find(
      (model) => model.value !== "default" && model.resolvedModel === value,
    );

  return match?.displayName ?? value;
}

const compactLevels: Record<string, string> = {
  none: "None",
  minimal: "Min",
  low: "L",
  medium: "M",
  high: "H",
  xhigh: "H+",
  max: "Max",
};

/** An effort as a summary abbreviation, such as "H"; unknown while the default is unresolved. */
export function compactReasoningLabel(value: string, inherited?: string) {
  const level = value === "default" ? inherited : value;

  return level && (compactLevels[level] ?? titleCase(level));
}

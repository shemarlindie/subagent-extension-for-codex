import { titleCase } from "../../../shared/text";

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

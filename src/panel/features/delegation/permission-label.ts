import { titleCase } from "../../../shared/text";

/**
 * A permission mode's label shortened for a chip: "Plan — read only" reads
 * "Plan", and the default mode reads by what it does, "Ask for approval".
 */
export function shortPermissionLabel(label: string) {
  if (label === "Use extension setting") return "Extension setting";

  const [name = label, detail] = label.split(" — ");

  return name === "Default" && detail ? titleCase(detail) : name;
}

const compactPermissionLabels: Record<string, string> = {
  "Read only": "Read",
  "Ask for approval": "Ask",
  "Accept edits": "Edits",
  "Bypass permission prompts": "Bypass",
  "Extension setting": "Inherit",
};

/** A chip label shortened further for a one-line summary: "Ask for approval" reads "Ask". */
export function compactPermissionLabel(chipLabel: string) {
  return compactPermissionLabels[chipLabel] ?? chipLabel;
}

import { titleCase } from "../../../shared/settings/settings-document";

/**
 * A permission mode's label shortened for a chip: "Plan — read only" reads
 * "Plan", and the default mode reads by what it does, "Ask for approval".
 */
export function shortPermissionLabel(label: string) {
  if (label === "Use extension setting") return "Extension setting";

  const [name = label, detail] = label.split(" — ");

  return name === "Default" && detail ? titleCase(detail) : name;
}

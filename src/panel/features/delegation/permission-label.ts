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

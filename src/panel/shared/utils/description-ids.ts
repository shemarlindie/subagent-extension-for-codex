/** Join the IDs of present descriptions for `aria-describedby`. */
export function descriptionIds(...ids: (string | undefined)[]) {
  return ids.filter(Boolean).join(" ") || undefined;
}

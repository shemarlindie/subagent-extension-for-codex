/** Generate a compact heading without changing the worker's full request. */
export function generateTaskTitle(description: string): string {
  const firstLine =
    description
      .trim()
      .split(/\r?\n/)
      .find((line) => line.trim()) ?? "";

  const text = firstLine.replace(/\s+/g, " ").trim();
  const sentence = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
  if (sentence.length <= 120) return sentence || "Untitled task";
  // Reserve room for the ellipsis without cutting a UTF-16 surrogate pair.
  const excerpt = sentence.slice(0, 119).replace(/[\uD800-\uDBFF]$/, "");
  const boundary = excerpt.lastIndexOf(" ");

  return (boundary > 0 ? excerpt.slice(0, boundary) : excerpt) + "…";
}

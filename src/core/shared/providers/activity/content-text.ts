/** An SDK message or tool result's text: its string content, or the text blocks of its content array. */
export function contentText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;

  return content
    .map((block: unknown) =>
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text"
        ? (block as { text?: unknown }).text
        : undefined,
    )
    .filter((text): text is string => typeof text === "string" && !!text)
    .join("\n");
}

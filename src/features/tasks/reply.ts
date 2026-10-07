/** The longest reply excerpt in task events, task lists and host payloads. */
export const REPLY_EXCERPT_CHARS = 1500;

/** The start of a reply, marked when it was cut. */
export function replyExcerpt(text: string, max = REPLY_EXCERPT_CHARS) {
  return text.length > max ? `${text.slice(0, max)}… (truncated)` : text;
}

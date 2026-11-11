const FENCE = /^\s*(`{3,}|~{3,})(.*)/;

/**
 * The text up to its last finished paragraph: the last blank line outside a
 * code fence. Blank lines inside a fence belong to the code, so a code block
 * shows once it closes and a blank line follows.
 */
export function completeParagraphs(text: string) {
  let end = 0,
    fence: string | undefined;

  // Only lines ending in a newline are finished. The last line may still grow.
  for (let start = 0, next; (next = text.indexOf("\n", start)) !== -1;) {
    const line = text.slice(start, next);
    const [, marker, info] = FENCE.exec(line) ?? [];

    if (fence) {
      // A closing fence repeats the opening character, at least as many
      // times, with nothing after it.
      if (
        marker &&
        marker[0] === fence[0] &&
        marker.length >= fence.length &&
        !info?.trim()
      ) {
        fence = undefined;
      }
    } else if (marker) {
      fence = marker;
    } else if (!line.trim()) {
      end = start;
    }

    start = next + 1;
  }

  return text.slice(0, end).trimEnd();
}

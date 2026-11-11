const FENCE = /^\s*(`{3,}|~{3,})(.*)/;

// Indented content and list items can belong to the block before a blank line.
const CONTINUATION = /^(\s|[-*+](\s|$)|\d{1,9}[.)](\s|$))/;

// Link and footnote definitions apply to the whole text.
const DEFINITION = /^ {0,3}\[[^\]]+\]:/m;

/**
 * Where each blank line outside a code fence starts. Blank lines inside a
 * fence belong to the code.
 */
function blankLines(text: string) {
  const blanks: number[] = [];
  let fence: string | undefined;

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
      blanks.push(start);
    }

    start = next + 1;
  }

  return blanks;
}

/**
 * The text up to its last finished paragraph: the last blank line outside a
 * code fence. A code block shows once it closes and a blank line follows.
 */
export function completeParagraphs(text: string) {
  return text.slice(0, blankLines(text).at(-1) ?? 0).trimEnd();
}

/**
 * The text split where its parts render the same separately as together, so a
 * streamed message parses each finished part once. A part ends at a blank line
 * outside a code fence, unless indented content or a list item follows. Text
 * with a link or footnote definition stays whole.
 */
export function markdownParts(text: string) {
  if (DEFINITION.test(text)) return [text];
  const parts: string[] = [];
  let start = 0;

  for (const blank of blankLines(text)) {
    const after = blank + /^(?:[ \t]*\n)*/.exec(text.slice(blank))![0].length;

    if (blank > start && !CONTINUATION.test(text.slice(after))) {
      parts.push(text.slice(start, blank).trimEnd());
      start = after;
    }
  }

  const rest = text.slice(start).trimEnd();

  return rest ? [...parts, rest] : parts;
}

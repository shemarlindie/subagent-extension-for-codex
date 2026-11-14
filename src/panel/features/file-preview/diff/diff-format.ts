/** Parsing a unified diff into files and the rows the diff view shows. */
import parseDiff from "parse-diff";

export type ParsedDiffFile = ReturnType<typeof parseDiff>[number];

const ESCAPES: Partial<Record<string, string>> = {
  a: "\x07",
  b: "\b",
  t: "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\",
};

/**
 * A path as Git wrote it in a quoted header, unescaped. The parser drops the
 * quotes but keeps C escapes; octal escapes are UTF-8 bytes. Git quotes every
 * path with a backslash, so a backslash always starts an escape.
 */
function unquoteDiffPath(path: string) {
  if (!path.includes("\\")) return path;

  const bytes: number[] = [];
  const encoder = new TextEncoder();

  for (let index = 0; index < path.length;) {
    const [, octal] =
      /^\\([0-3][0-7]{2})/.exec(path.slice(index, index + 4)) ?? [];

    const escaped =
      path[index] === "\\" ? ESCAPES[path.charAt(index + 1)] : undefined;

    if (octal !== undefined) {
      bytes.push(parseInt(octal, 8));
      index += 4;
    } else if (escaped !== undefined) {
      bytes.push(...encoder.encode(escaped));
      index += 2;
    } else {
      // A string's iterator yields whole code points, keeping surrogate pairs.
      const [char = ""] = path.slice(index, index + 2);
      bytes.push(...encoder.encode(char));
      index += char.length;
    }
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function parseDiffFiles(content: string): ParsedDiffFile[] {
  try {
    return parseDiff(content)
      .filter((file) => file.chunks.length || file.from)
      .map((file) => ({
        ...file,
        ...(file.from ? { from: unquoteDiffPath(file.from) } : {}),
        ...(file.to ? { to: unquoteDiffPath(file.to) } : {}),
      }));
  } catch {
    return [];
  }
}

/** The path a diff file is shown under: its new path, or its old one when deleted. */
export function diffPath(file: ParsedDiffFile) {
  const path = file.to && file.to !== "/dev/null" ? file.to : file.from;

  return path ?? "unknown";
}

export type DiffRow =
  | { kind: "hunk"; content: string }
  /** Git's markers between lines, such as "No newline at end of file". */
  | { kind: "note"; content: string }
  | {
      kind: "line";
      type: "add" | "del" | "normal";
      oldLine?: number;
      newLine?: number;
      text: string;
    };

/** A line without its CRLF ending's carriage return. */
function withoutCr(text: string) {
  return text.endsWith("\r") ? text.slice(0, -1) : text;
}

type DiffChange = ParsedDiffFile["chunks"][number]["changes"][number];

/** The line number on the old side of a change; only unchanged and removed lines have one. */
function oldLineOf(change: DiffChange) {
  if (change.type === "normal") return change.ln1;

  return change.type === "del" ? change.ln : undefined;
}

/** The line number on the new side of a change; only unchanged and added lines have one. */
function newLineOf(change: DiffChange) {
  if (change.type === "normal") return change.ln2;

  return change.type === "add" ? change.ln : undefined;
}

/** A diff file's hunk headers and lines, in order, with line numbers. */
export function diffRows(file: ParsedDiffFile): DiffRow[] {
  return file.chunks.flatMap((chunk): DiffRow[] => [
    { kind: "hunk", content: withoutCr(chunk.content) },
    ...chunk.changes.map((change): DiffRow => {
      // The parser files a "\ No newline" marker as a change of the line before.
      if (change.content.startsWith("\\")) {
        return {
          kind: "note",
          content: withoutCr(change.content.slice(1).trim()),
        };
      }

      return {
        kind: "line",
        type: change.type,
        oldLine: oldLineOf(change),
        newLine: newLineOf(change),
        text: withoutCr(change.content.slice(1)),
      };
    }),
  ]);
}

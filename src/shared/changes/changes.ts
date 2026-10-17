/**
 * A task's recorded tool edits: per-file stats for
 * every file, and the unified diff in pages of whole files.
 */

export type ChangeScope = "task" | "turn";

type ChangeStatus = "added" | "modified" | "deleted";

export interface ChangedFile {
  path: string;
  status: ChangeStatus;
  additions: number;
  deletions: number;
  source: "tool" | "command";
  incomplete: boolean;
}

export interface Changes {
  scope: ChangeScope;
  unrecorded_commands?: boolean;
  branch?: string;
  /** Every changed file, on every page. */
  files: ChangedFile[];
  additions: number;
  deletions: number;
  /** This page's part of the diff: whole files, in `files` order. */
  diff: string;
  /** Pass back to read the next page; absent on the last one. */
  next_cursor?: string;
}

/**
 * A task's change totals: the file count and line stats, without the file
 * list or diff. Incomplete files count as files but add no lines.
 */
export type ChangeCounts = Omit<Changes, "files" | "diff" | "next_cursor"> & {
  files: number;
};

/** The totals of a read, for the tab count and Details; any page gives the same ones. */
export function changeCounts({
  files,
  diff: _diff,
  next_cursor: _next,
  ...totals
}: Changes): ChangeCounts {
  return { ...totals, files: files.length };
}

/** A changed file's current content, as get_agent_changed_file returns it. */
export interface ChangedFileContent {
  path: string;
  /** "deleted": missing now. "unavailable": workspace removed. "binary": other binary content. */
  state: "present" | "deleted" | "binary" | "unavailable";
  /** Bytes in the file. */
  size: number;
  mime_type?: string;
  /** UTF-8 text, or base64 for images; this page's part of it. */
  content?: string;
  encoding?: "utf8" | "base64";
  /** Pass back to read the next part; absent on the last one. */
  next_cursor?: string;
}

/** Images a preview can show; their content is sent as base64. */
const IMAGE_MIMES: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export const imageMime = (path: string) =>
  IMAGE_MIMES[/\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ""];

/** Git's own test: a NUL byte in the first 8,000 bytes means binary. */
export const isBinary = (bytes: Uint8Array) =>
  bytes.subarray(0, 8000).includes(0);

/** File cursors fingerprint the bytes, rejecting content changed between pages. */
export function encodeFileCursor(tree: string, offset: number) {
  return `${tree}:${offset}`;
}

export function decodeFileCursor(cursor: string) {
  const [, tree, offset] = /^([0-9a-f]{40,64}):(\d+)$/.exec(cursor) ?? [];

  if (tree === undefined || offset === undefined) {
    throw new Error("Invalid file cursor");
  }

  return { tree, offset: Number(offset) };
}

/** Diff text per page. A file larger than this is still sent whole. */
export const CHANGES_PAGE_CHARS = 1_000_000;

/** Splits a unified Git diff into one part per file. */
export function diffParts(diff: string) {
  return diff.split(/^(?=diff --git )/m).filter(Boolean);
}

/** One page of whole files from `start`, at least one file long. */
export function diffPage(parts: string[], start: number, pageChars: number) {
  let end = start,
    size = 0;

  for (const part of parts.slice(start)) {
    if (end > start && size + part.length > pageChars) break;
    size += part.length;
    end++;
  }

  return { diff: parts.slice(start, end).join(""), end };
}

/** Cursors fingerprint the rows and task scope, rejecting edits between pages. */
export function encodeCursor(base: string, current: string, index: number) {
  return `${base}:${current}:${index}`;
}

export function decodeCursor(cursor: string) {
  const [, base, current, index] =
    /^([0-9a-f]{40,64}):([0-9a-f]{40,64}):(\d+)$/.exec(cursor) ?? [];

  if (base === undefined || current === undefined || index === undefined) {
    throw new Error("Invalid changes cursor");
  }

  return { base, current, index: Number(index) };
}

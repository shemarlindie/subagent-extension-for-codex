/**
 * A task's changes as Git reports them between two trees: per-file stats for
 * every file, and the unified diff in pages of whole files.
 */

export type ChangeScope = "task" | "turn";

export type ChangeStatus =
  "added" | "modified" | "deleted" | "renamed" | "copied" | "type_changed";

export interface ChangedFile {
  path: string;
  /** The previous path of a renamed or copied file. */
  old_path?: string;
  status: ChangeStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  /** A binary file's current size in bytes, unless it was deleted. */
  size?: number;
}

export interface Changes {
  scope: ChangeScope;
  /**
   * "workspace_missing": the worktree was removed, so the changes are what
   * is committed on `branch`, and there are no uncommitted ones.
   * "branch_deleted": the branch was deleted too, and there are none.
   * "end_unrecorded": a current_repo task ended before end snapshots were
   * recorded, so there are none (see END_UNRECORDED).
   */
  state?: "workspace_missing" | "branch_deleted" | "end_unrecorded";
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

/** A task's change totals: the file count and line stats, without the file list or diff. */
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

/** Why an "end_unrecorded" task has no changes. */
export const END_UNRECORDED =
  "This task ended before its end state was recorded, so its changes can't be told apart from later edits to this checkout.";

/** A changed file's current content, as get_agent_changed_file returns it. */
export interface ChangedFileContent {
  path: string;
  /** "deleted": the change removed it. "binary": not text and not an image. */
  state: "present" | "deleted" | "binary";
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

/** File cursors name the snapshot tree, so later parts read the same file. */
export function encodeFileCursor(tree: string, offset: number) {
  return `${tree}:${offset}`;
}

export function decodeFileCursor(cursor: string) {
  const match = /^([0-9a-f]{40,64}):(\d+)$/.exec(cursor);
  if (!match) throw new Error("Invalid file cursor");

  return { tree: match[1], offset: Number(match[2]) };
}

/** Diff text per page. A file larger than this is still sent whole. */
export const CHANGES_PAGE_CHARS = 1_000_000;

const statuses: Record<string, ChangeStatus> = {
  A: "added",
  M: "modified",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type_changed",
};

/**
 * Joins `git diff -z --name-status` and `git diff -z --numstat` output for
 * the same trees, which list files in the same order.
 */
export function changedFiles(nameStatus: string, numstat: string) {
  const names = nameStatus.split("\0"),
    stats = numstat.split("\0"),
    files: ChangedFile[] = [];

  for (let n = 0, s = 0; n < names.length && names[n];) {
    const code = names[n++],
      status = statuses[code[0]] ?? "modified",
      paired = status === "renamed" || status === "copied",
      old_path = paired ? names[n++] : undefined,
      path = names[n++];

    // "added\tdeleted\tpath", or "added\tdeleted\t" then both paths.
    const [additions, deletions] = stats[s++].split("\t");
    s += paired ? 2 : 0;
    const binary = additions === "-";

    files.push({
      path,
      ...(old_path === undefined ? {} : { old_path }),
      status,
      additions: binary ? 0 : Number(additions),
      deletions: binary ? 0 : Number(deletions),
      binary,
    });
  }

  return files;
}

/** Splits a unified Git diff into one part per file. */
export function diffParts(diff: string) {
  return diff.split(/^(?=diff --git )/m).filter(Boolean);
}

/** One page of whole files from `start`, at least one file long. */
export function diffPage(parts: string[], start: number, pageChars: number) {
  let end = start,
    size = 0;

  while (
    end < parts.length &&
    (end === start || size + parts[end].length <= pageChars)
  ) {
    size += parts[end++].length;
  }

  return { diff: parts.slice(start, end).join(""), end };
}

/** Cursors name the two trees, so later pages diff the same state. */
export function encodeCursor(base: string, current: string, index: number) {
  return `${base}:${current}:${index}`;
}

export function decodeCursor(cursor: string) {
  const match = /^([0-9a-f]{40,64}):([0-9a-f]{40,64}):(\d+)$/.exec(cursor);
  if (!match) throw new Error("Invalid changes cursor");

  return { base: match[1], current: match[2], index: Number(match[3]) };
}

/**
 * A task's changes as Git reports them between two trees: per-file stats for
 * every file, and the unified diff in pages of whole files.
 */

export type ChangeScope = "task" | "turn";

type ChangeStatus =
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
  /**
   * Uncommitted changes only: a commit after the task's changes ended
   * replaced the file with other content. Its stats and diff are the task's
   * own, as they were then, and it isn't counted in the totals.
   */
  superseded?: true;
  /** "command": a shell command made at least one of the recorded edits. */
  source?: "tool" | "command";
  /** An edit couldn't be recorded, so the file has no diff or stats. */
  incomplete?: boolean;
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
  /** A command changed files whose edits weren't recorded. */
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
 * list or diff. Superseded files aren't counted.
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
  return {
    ...totals,
    files: files.filter((f) => !f.superseded && !f.incomplete).length,
  };
}

/** Why an "end_unrecorded" task has no changes. */
export const END_UNRECORDED =
  "This task ended before its end state was recorded, so its changes can't be told apart from later edits to this checkout.";

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

const statuses: Partial<Record<string, ChangeStatus>> = {
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

  let n = 0,
    s = 0;

  const field = (fields: string[], index: number) => {
    // Git never lists an empty path or record; -z output ends with a NUL.
    const value = fields[index];
    if (!value) throw new Error("Truncated Git diff output");

    return value;
  };

  for (let code = names[n]; code; code = names[n]) {
    n++;

    const status = statuses[code.charAt(0)] ?? "modified",
      paired = status === "renamed" || status === "copied",
      old_path = paired ? field(names, n++) : undefined,
      path = field(names, n++);

    // "added\tdeleted\tpath", or "added\tdeleted\t" then both paths.
    const [additions, deletions] = field(stats, s++).split("\t");

    if (deletions === undefined) {
      throw new Error("Malformed Git numstat output");
    }

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

  for (const part of parts.slice(start)) {
    if (end > start && size + part.length > pageChars) break;
    size += part.length;
    end++;
  }

  return { diff: parts.slice(start, end).join(""), end };
}

/** Cursors name the two trees, so later pages diff the same state. */
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

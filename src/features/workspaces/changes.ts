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
}

export interface Changes {
  scope: ChangeScope;
  /** Set when the worktree was removed; the work is on `branch`. */
  state?: "workspace_missing";
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
  )
    size += parts[end++].length;

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

import type { Snapshot } from "../../app/state/types";
import {
  parseDiffFiles,
  type ParsedDiffFile,
} from "../file-preview/diff/diff-format";
import type { ListedChange } from "./types";

/** A file's header without lines, shown until its diff is read or when it has none. */
export function standIn(file: ListedChange): ParsedDiffFile {
  return {
    chunks: [],
    additions: file.additions,
    deletions: file.deletions,
    from: file.status === "added" ? "/dev/null" : file.path,
    to: file.status === "deleted" ? "/dev/null" : file.path,
    ...(file.status === "added" ? { new: true } : {}),
    ...(file.status === "deleted" ? { deleted: true } : {}),
  };
}

/** A file's diff text, parsed. Undefined when it has none or it can't be parsed. */
export function parseFileDiff(diff?: string) {
  return diff === undefined ? undefined : parseDiffFiles(diff)[0];
}

/** Long lists stay scannable by opening only their first file by default. */
const OPEN_FILES = 8;

/**
 * Whether a file in the Changes list starts open: every file of a short
 * list, or a long list's first.
 */
export function opensByDefault(count: number, index: number) {
  return count <= OPEN_FILES || index === 0;
}

/** The diffs read for the task's current change list, so two revisions never mix. */
export function listedDiffs(
  { changes, changeDiffs }: Pick<Snapshot, "changes" | "changeDiffs">,
  task: string,
) {
  return changes?.task === task &&
    changeDiffs?.task === task &&
    changeDiffs.revision === changes.data?.revision
    ? changeDiffs.files
    : undefined;
}

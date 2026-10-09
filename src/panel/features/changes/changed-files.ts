import {
  diffPath,
  type ParsedDiffFile,
  parseDiffFiles,
} from "../file-preview/file-format";
import type { ChangedFile, Changes } from "./types";

/** A changed file with its part of the task's diff. */
export type ChangedFileEntry = {
  file: ChangedFile;
  /** The file's part of the diff, or a stand-in with no lines when it has none. */
  diff: ParsedDiffFile;
  /** The diff had no part for the file, so `diff` is a stand-in. */
  missing?: boolean;
};

/** A file's header without lines, for a file the diff has no part for. */
function standIn(file: ChangedFile): ParsedDiffFile {
  return {
    chunks: [],
    additions: file.additions,
    deletions: file.deletions,
    from: file.status === "added" ? "/dev/null" : (file.old_path ?? file.path),
    to: file.status === "deleted" ? "/dev/null" : file.path,
    ...(file.status === "added" ? { new: true } : {}),
    ...(file.status === "deleted" ? { deleted: true } : {}),
  };
}

// Parsed once per read, however many views ask.
const entries = new WeakMap<Changes, ChangedFileEntry[]>();

/** Each changed file in Git's order, with its diff. */
export function changedFileEntries(changes: Changes): ChangedFileEntry[] {
  let result = entries.get(changes);

  if (!result) {
    const byPath = new Map<string, ParsedDiffFile>();

    for (const diff of parseDiffFiles(changes.diff)) {
      const path = diffPath(diff);
      if (!byPath.has(path)) byPath.set(path, diff);
    }

    // Matched by path, so a part the parser skipped can't shift the rest, and
    // a file with no part gets a stand-in rather than another file's.
    result = changes.files.map((file) => {
      const diff = byPath.get(file.path);

      return {
        file,
        diff: diff ?? standIn(file),
        ...(diff ? {} : { missing: true }),
      };
    });

    entries.set(changes, result);
  }

  return result;
}

/**
 * A changed file's part of the task's diff. Binary files have no lines to
 * show, and a stand-in has none, so they have none.
 */
export function changedFileDiff(
  changes: Changes,
  path: string,
): ParsedDiffFile | undefined {
  const entry = changedFileEntries(changes).find(
    (entry) => entry.file.path === path,
  );

  return entry?.file.binary || entry?.missing ? undefined : entry?.diff;
}

import {
  diffPath,
  type ParsedDiffFile,
  parseDiffFiles,
} from "../file-preview/diff/diff-format";
import type { ChangedFile, Changes } from "./types";

/** A changed file with its part of the task's diff. */
export type ChangedFileEntry = {
  file: ChangedFile;
  /** The file's part of the diff, or a stand-in with no lines when it has none. */
  diff: ParsedDiffFile;
  /** The diff had no part for the file, so `diff` is a stand-in. */
  missing?: boolean;
  /** Identifies the file's changes, so marking it viewed lasts until they change. */
  signature: string;
};

/** FNV-1a: a short, stable hash of the parts. */
function hash(parts: Iterable<string>) {
  let value = 0x811c9dc5;

  for (const part of parts) {
    for (let index = 0; index < part.length; index++) {
      value ^= part.charCodeAt(index);
      value = Math.imul(value, 0x01000193);
    }

    // Separates parts, so "ab" + "c" differs from "a" + "bc".
    value = Math.imul(value ^ 0xff, 0x01000193);
  }

  return (value >>> 0).toString(36);
}

/** A file's header without lines, for a file the diff has no part for. */
function standIn(file: ChangedFile): ParsedDiffFile {
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

function* signatureParts(file: ChangedFile, diff?: ParsedDiffFile) {
  yield file.status;
  yield String(file.incomplete);
  yield file.source;
  // Without a diff, the counts stand in for its lines.
  if (!diff) yield `${file.additions}:${file.deletions}`;

  for (const chunk of diff?.chunks ?? []) {
    yield chunk.content;
    for (const change of chunk.changes) yield change.content;
  }
}

// Parsed once per read, however many views ask.
const entries = new WeakMap<Changes, ChangedFileEntry[]>();

/** Each recorded changed file, with its diff and signature. */
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
        signature: hash(signatureParts(file, diff)),
      };
    });

    entries.set(changes, result);
  }

  return result;
}

/**
 * A changed file's part of the task's diff. Incomplete files and stand-ins have no diff.
 */
export function changedFileDiff(
  changes: Changes,
  path: string,
): ParsedDiffFile | undefined {
  const entry = changedFileEntries(changes).find(
    (entry) => entry.file.path === path,
  );

  return entry?.file.incomplete || entry?.missing ? undefined : entry?.diff;
}

/** Long lists stay scannable by opening only their first file by default. */
const OPEN_FILES = 8;

/**
 * Whether a file in the Changes list starts open: every file of a short
 * list, or a long list's first.
 */
export function opensByDefault(entries: ChangedFileEntry[], index: number) {
  return entries.length <= OPEN_FILES || index === 0;
}

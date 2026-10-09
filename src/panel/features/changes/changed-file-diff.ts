import {
  type ParsedDiffFile,
  parseDiffFiles,
} from "../file-preview/file-format";
import type { Changes } from "./types";

/**
 * A changed file's part of the task's diff. Binary files have no lines to
 * show, so they have none.
 */
export function changedFileDiff(
  changes: Changes,
  path: string,
): ParsedDiffFile | undefined {
  // Git lists files in the same order in the diff and the file list.
  const index = changes.files.findIndex((file) => file.path === path);
  if (index < 0 || changes.files[index].binary) return undefined;

  return parseDiffFiles(changes.diff)[index];
}

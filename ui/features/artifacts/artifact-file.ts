import parseDiff from "parse-diff";

import { isResultShape } from "../../../src/features/artifacts/artifact-file";
import type { Result } from "../../../src/shared/contracts";

// Format detection, file names and card summaries are shared with the service.
export * from "../../../src/features/artifacts/artifact-file";

export type DiffFile = ReturnType<typeof parseDiff>[number];

export function parseArtifactDiff(content: string): DiffFile[] {
  try {
    return parseDiff(content).filter((file) => file.chunks.length || file.from);
  } catch {
    return [];
  }
}

/** The path a diff file is shown under: its new path, or its old one when deleted. */
export function diffPath(file: DiffFile) {
  const path = file.to && file.to !== "/dev/null" ? file.to : file.from;

  return path ?? "unknown";
}

/** A worker result report, which the preview can render as a report instead of JSON. */
export function resultShape(content: string): Result | undefined {
  try {
    const value = JSON.parse(content);

    return isResultShape(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

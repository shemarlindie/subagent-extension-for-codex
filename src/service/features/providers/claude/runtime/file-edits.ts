import { structuredPatch, type StructuredPatchHunk as Hunk } from "diff";
import { z } from "zod";

import { logError } from "../../../../platform/logging/logger.js";
import type { FileEdit, RunContext } from "../../types.js";

interface FileEdits {
  edits: FileEdit[];
  unrecorded: (string | undefined)[];
}

const hunksSchema = z.array(
  z.object({
    oldStart: z.number().int().nonnegative(),
    oldLines: z.number().int().nonnegative(),
    newStart: z.number().int().nonnegative(),
    newLines: z.number().int().nonnegative(),
    lines: z.array(z.string()),
  }),
);

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return undefined;
}

function path(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function computedHunks(before: unknown, after: unknown): Hunk[] | undefined {
  if (typeof before !== "string" || typeof after !== "string") return;

  return structuredPatch("", "", before, after, undefined, undefined, {
    context: 3,
  }).hunks;
}

function add(
  result: FileEdits,
  filePath: string | undefined,
  hunks: Hunk[] | undefined,
  flags: Pick<FileEdit, "created" | "deleted" | "source">,
) {
  if (!filePath || !hunks) {
    result.unrecorded.push(filePath);
  } else if (hunks.length) {
    result.edits.push({ path: filePath, hunks, ...flags });
  }
}

function toolEdit(
  result: FileEdits,
  tool: "Write" | "Edit" | "NotebookEdit",
  response: Record<string, unknown>,
) {
  if (tool !== "NotebookEdit" && response.staged === true) return;

  if (tool === "NotebookEdit") {
    add(
      result,
      path(response.notebook_path),
      computedHunks(response.original_file, response.updated_file),
      { source: "tool" },
    );

    return;
  }

  const filePath = path(response.filePath);
  const patch = hunksSchema.safeParse(response.structuredPatch);
  let hunks = patch.success ? patch.data : undefined;

  const created =
    tool === "Write"
      ? response.type === "create"
      : response.oldString === "" && response.originalFile === "";

  if (tool === "Write" && created) {
    hunks = computedHunks("", response.content);
  } else if (tool === "Write" && hunks?.length === 0) {
    hunks = computedHunks(response.originalFile, response.content);
  }

  add(result, filePath, hunks, {
    source: "tool",
    ...(created ? { created: true } : {}),
  });
}

function commandEdits(result: FileEdits, response: Record<string, unknown>) {
  const diff = record(response.bashEditDiff);
  if (!diff) return;

  if (diff.unavailable === true || diff.skipped === true) {
    result.unrecorded.push(undefined);

    return;
  }

  const handled = new Set<string>();

  if (Array.isArray(diff.files)) {
    for (const value of diff.files) {
      const file = record(value);
      const filePath = path(file?.filePath);
      if (filePath) handled.add(filePath);
      const hunks = hunksSchema.safeParse(file?.hunks);

      add(result, filePath, hunks.success ? hunks.data : undefined, {
        source: "command",
        ...(file?.created === true ? { created: true } : {}),
        ...(file?.deleted === true ? { deleted: true } : {}),
      });
    }
  }

  const missing = new Set<string>();

  if (Array.isArray(diff.changedFiles)) {
    for (const value of diff.changedFiles) {
      const filePath = path(value);
      if (filePath && !handled.has(filePath)) missing.add(filePath);
    }
  }

  result.unrecorded.push(...missing);

  if (typeof diff.moreFiles === "number" && diff.moreFiles > missing.size) {
    result.unrecorded.push(undefined);
  }
}

/** Maps successful Claude tool responses without reading the workspace. */
export function claudeFileEdits(
  toolName: string,
  response: unknown,
): FileEdits {
  const result: FileEdits = { edits: [], unrecorded: [] };
  const value = record(response);
  if (!value || value.is_error || value.isError || value.error) return result;

  if (
    toolName === "Write" ||
    toolName === "Edit" ||
    toolName === "NotebookEdit"
  ) {
    toolEdit(result, toolName, value);
  } else if (toolName === "Bash") {
    commandEdits(result, value);
  }

  return result;
}

/** Recording failures must never block a tool that already ran successfully. */
export function recordClaudeFileEdits(
  context: Pick<RunContext, "fileChanged" | "editUnrecorded">,
  toolName: string,
  response: unknown,
): void {
  try {
    const result = claudeFileEdits(toolName, response);

    for (const edit of result.edits) context.fileChanged(edit);

    for (const filePath of result.unrecorded) {
      context.editUnrecorded(
        filePath,
        toolName === "Bash" ? "command" : "tool",
      );
    }
  } catch (error) {
    logError("provider.edit_capture_failed", error, { tool: toolName });
  }
}

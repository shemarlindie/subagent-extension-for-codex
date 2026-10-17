import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { applyPatch } from "diff";

import { changePath } from "../../../src/service/features/changes/paths";
import { recordClaudeFileEdits } from "../../../src/service/features/providers/claude/runtime/file-edits";
import type {
  FileEdit,
  RunContext,
} from "../../../src/service/features/providers/types";
import type { Control } from "../../../src/service/features/tasks/runtime/control";
import type { Event } from "../../../src/shared/events/types";
import type { Task } from "../../../src/shared/tasks/model";

/** Populate previews only when a recorded response supplies a complete preimage. */
function materialize(root: string, edit: FileEdit, original: unknown) {
  const target = join(root, edit.path);

  if (edit.deleted) {
    rmSync(target, { force: true });

    return;
  }

  let before: string | undefined;

  try {
    before = readFileSync(target, "utf8");
  } catch {
    if (typeof original === "string") before = original;
  }

  if (edit.created) before ??= "";
  if (before === undefined) return;

  const after = applyPatch(before, {
    oldFileName: edit.path,
    newFileName: edit.path,
    oldHeader: undefined,
    newHeader: undefined,
    hunks: edit.hunks,
  });

  if (after === false) return;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, after);
}

/** Main-worker stream results replay through the production PostToolUse mapper. */
export function replayRecordedEdits(
  control: Control,
  task: Task,
  events: Event[],
) {
  const root = join(control.workspaces.root, "recorded", task.id);
  mkdirSync(root, { recursive: true });
  task.workspace = root;
  control.store.save(task);
  let original: unknown;
  const relativePath = (path: string) => path.replace(/^\/demo\/project\//, "");

  const context: Pick<RunContext, "fileChanged" | "editUnrecorded"> = {
    fileChanged: (edit) => {
      const normalized = { ...edit, path: relativePath(edit.path) };
      if (changePath(root, normalized.path) !== normalized.path) return;
      materialize(root, normalized, original);
      control.changes.record(task, normalized);
    },
    editUnrecorded: (path, source) =>
      control.changes.unrecorded(task, path && relativePath(path), source),
  };

  const tools = new Map<string, string>();

  for (const event of events.filter((event) => event.task_id === task.id)) {
    if (event.type === "tool.started") {
      tools.set(String(event.data.id), String(event.data.name));
    }

    if (event.type === "task.started") control.changes.clearTurn(task);
    if (event.type !== "tool.completed" || event.data.error) continue;

    const raw = event.data.raw_response as
      { tool_use_result?: Record<string, unknown> } | undefined;

    const response = raw?.tool_use_result;
    if (!response) continue;
    original = response.originalFile ?? response.original_file;

    recordClaudeFileEdits(
      context,
      tools.get(String(event.data.id)) ?? "",
      response,
    );
  }
}

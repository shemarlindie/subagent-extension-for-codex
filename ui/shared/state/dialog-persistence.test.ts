import assert from "node:assert/strict";

import { test } from "vitest";

import {
  parsePersistedDialog,
  parsePersistedDialogs,
  persistDialog,
  persistedDialogId,
  sameDialogReference,
} from "./dialog-persistence";
import type { DialogState } from "./types";

test("delete dialogs round-trip their task reference and reject missing targets", () => {
  const dialog = {
    kind: "delete",
    task: { id: "task-1" },
    scope: 1,
  } as Extract<DialogState, { kind: "delete" }>;

  const persisted = persistDialog(dialog);

  assert.deepEqual(parsePersistedDialog(persisted), {
    kind: "delete",
    taskId: "task-1",
  });

  assert.equal(persistedDialogId(persisted), "delete_task");
  assert.equal(parsePersistedDialog({ kind: "delete", taskId: "" }), undefined);
  assert.equal(parsePersistedDialog({ kind: "delete" }), undefined);
});

test("parses only valid dialog descriptors and keeps the newest eight", () => {
  const entries = Array.from({ length: 10 }, (_, index) => ({
    kind: "project",
    repository: `/repo/${index}`,
  }));

  assert.deepEqual(
    parsePersistedDialogs([
      ...entries,
      { kind: "control", action: "delete", taskId: "task-1" },
      { kind: "file", taskId: "", path: "src/main.ts" },
    ]),
    entries.slice(-8),
  );
});

test("dialog identity ignores draft edits but includes the dialog target", () => {
  const saved = {
    kind: "handoff" as const,
    taskId: "task-1",
    draft: { message: "first" },
  };

  assert.equal(
    sameDialogReference(saved, {
      ...saved,
      draft: { message: "second" },
    }),
    true,
  );

  assert.equal(
    sameDialogReference(saved, { ...saved, taskId: "task-2" }),
    false,
  );
});

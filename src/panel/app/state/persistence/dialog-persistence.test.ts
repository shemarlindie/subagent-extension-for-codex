import assert from "node:assert/strict";

import { test } from "vitest";

import type { DialogState } from "../types";
import {
  parsePersistedDialog,
  parsePersistedDialogs,
  persistDialog,
  persistedDialogId,
  sameDialogReference,
} from "./dialog-persistence";

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

test("Add project keeps its new-task origin across a reload", () => {
  const persisted = persistDialog({
    kind: "project",
    repository: "/repo",
    forNewTask: true,
    scope: 1,
  });

  assert.deepEqual(parsePersistedDialog(persisted), {
    kind: "project",
    repository: "/repo",
    forNewTask: true,
  });

  assert.deepEqual(parsePersistedDialog({ kind: "project", forNewTask: 1 }), {
    kind: "project",
  });
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
      { kind: "file", taskId: "", path: "src/service/main.ts" },
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

for (const target of [
  { kind: "reply", id: "older-reply" },
  { kind: "file", path: "src/auth.ts" },
] as const) {
  test(`targeted ${target.kind} handoffs round-trip their target and edited draft`, () => {
    const dialog = {
      kind: "handoff",
      task: { id: "task-1" },
      scope: 1,
      target,
    } as Extract<DialogState, { kind: "handoff" }>;

    const persisted = persistDialog(dialog);

    if (persisted.kind !== "handoff") {
      throw new Error("Expected handoff descriptor");
    }

    const draft = { message: "Edited question about the selected context." };

    assert.deepEqual(parsePersistedDialog({ ...persisted, draft }), {
      kind: "handoff",
      taskId: "task-1",
      target,
      draft,
    });

    assert.equal(sameDialogReference(persisted, { ...persisted, draft }), true);

    assert.equal(
      sameDialogReference(persisted, {
        kind: "handoff",
        taskId: "task-1",
      }),
      false,
    );

    assert.equal(
      sameDialogReference(persisted, {
        ...persisted,
        target:
          target.kind === "reply"
            ? { kind: "reply", id: "another-reply" }
            : { kind: "file", path: "src/another.ts" },
      }),
      false,
    );
  });
}

test("malformed handoff targets are rejected instead of becoming whole-task handoffs", () => {
  for (const target of [
    null,
    [],
    "reply",
    { kind: "reply" },
    { kind: "reply", id: "" },
    { kind: "reply", id: 42 },
    { kind: "file", path: "" },
    { kind: "file", path: ["src/auth.ts"] },
    { kind: "message", id: "reply" },
  ]) {
    assert.equal(
      parsePersistedDialog({
        kind: "handoff",
        taskId: "task-1",
        target,
        draft: { message: "An edited question." },
      }),
      undefined,
    );
  }
});

test("malformed worktree actions or file lists invalidate the confirmation", () => {
  const saved = { kind: "worktree", taskId: "task-1", action: "remove" };

  for (const invalid of [
    { action: undefined },
    { action: "delete" },
    { files: null },
    { files: "src/auth.ts" },
    { files: ["src/auth.ts", 42] },
  ]) {
    assert.equal(parsePersistedDialog({ ...saved, ...invalid }), undefined);
  }

  assert.deepEqual(parsePersistedDialog({ ...saved, files: ["src/auth.ts"] }), {
    ...saved,
    files: ["src/auth.ts"],
  });
});

test("malformed optional fields are omitted while the dialog draft survives", () => {
  const draft = { message: "Keep my unsent answer" };

  assert.deepEqual(
    parsePersistedDialog({
      kind: "respond",
      taskId: "task-1",
      requestId: 42,
      draft,
    }),
    { kind: "respond", taskId: "task-1", draft },
  );

  assert.deepEqual(
    parsePersistedDialog({
      kind: "delegate",
      preferredWorker: ["claude"],
      repository: null,
      revision: 42,
      draft: { description: "Keep my unsent task" },
    }),
    { kind: "delegate", draft: { description: "Keep my unsent task" } },
  );
});

test("non-record drafts are ignored without losing the dialog reference", () => {
  for (const draft of [null, ["Unsent message"], "Unsent message", 42]) {
    assert.deepEqual(
      parsePersistedDialog({ kind: "respond", taskId: "task-1", draft }),
      { kind: "respond", taskId: "task-1" },
    );
  }
});

test("project removal restores only its target even when storage supplies a draft", () => {
  assert.deepEqual(
    parsePersistedDialog({
      kind: "remove-project",
      repository: "/repo/a",
      draft: { delete_tasks: true },
    }),
    { kind: "remove-project", repository: "/repo/a" },
  );
});

test("file previews require a string path while preserving an empty stored path", () => {
  const saved = { kind: "file", taskId: "task-1" };

  assert.equal(parsePersistedDialog(saved), undefined);
  assert.equal(parsePersistedDialog({ ...saved, path: [] }), undefined);

  assert.deepEqual(parsePersistedDialog({ ...saved, path: "" }), {
    ...saved,
    path: "",
  });
});

import assert from "node:assert/strict";

import { test } from "vitest";

import {
  parsePersistedDialogs,
  sameDialogReference,
} from "./dialog-persistence";

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
    kind: "control" as const,
    action: "steer" as const,
    taskId: "task-1",
    draft: { instruction: "first" },
  };

  assert.equal(
    sameDialogReference(saved, {
      ...saved,
      draft: { instruction: "second" },
    }),
    true,
  );

  assert.equal(
    sameDialogReference(saved, { ...saved, taskId: "task-2" }),
    false,
  );
});

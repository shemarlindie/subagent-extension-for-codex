import assert from "node:assert/strict";

import { test } from "vitest";

import { task } from "./controller-test-harness";
import { defaultTask } from "./selection";

test("the default task prefers one waiting for input, then an unfinished one", () => {
  const done = { ...task("done"), status: "completed" as const };
  const running = task("running");

  const waiting = {
    ...task("waiting"),
    status: "waiting" as const,
    pending_input: {
      id: "input",
      tool: "AskUserQuestion",
      kind: "question" as const,
      input: {},
    },
  };

  assert.equal(defaultTask([done, running, waiting])?.id, "waiting");
  assert.equal(defaultTask([done, running])?.id, "running");
  assert.equal(defaultTask([done])?.id, "done");
  assert.equal(defaultTask([]), undefined);
});

test("the default task is never an archived one", () => {
  const archived = {
    ...task("archived"),
    status: "completed" as const,
    archived_at: "then",
  };

  const done = { ...task("done"), status: "completed" as const };

  assert.equal(defaultTask([archived, done])?.id, "done");
  assert.equal(defaultTask([archived]), undefined);
});

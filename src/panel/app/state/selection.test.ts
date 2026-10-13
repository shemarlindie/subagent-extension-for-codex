import assert from "node:assert/strict";

import { test } from "vitest";

import { task } from "./controller-test-harness";
import { defaultTask, selectionPatch } from "./selection";

test("the default task prefers one waiting for input, then an unfinished one", () => {
  const done = { ...task("done"), status: "completed" as const },
    running = task("running"),
    waiting = {
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

test("a selection clears the previous task's detail and loads the new one's", () => {
  const patch = selectionPatch("task");

  assert.equal(patch.selected, "task");
  assert.equal(patch.chatHistoryLoading, "task");
  assert.equal(patch.activityHistoryLoading, "task");
  assert.deepEqual(patch.events, []);
  assert.equal(patch.droppedEvents, undefined);
  assert.equal(patch.chat, undefined);
  assert.equal(patch.draft, undefined);
});

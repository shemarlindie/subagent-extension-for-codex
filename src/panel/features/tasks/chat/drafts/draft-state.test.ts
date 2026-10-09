import assert from "node:assert/strict";

import { test } from "vitest";

import { applyDraftUpdate } from "./draft-state";

test("streamed text builds a draft, another message replaces it, and a clear removes it", () => {
  let { draft } = applyDraftUpdate(undefined, {
    task_id: "t",
    message_id: "m1",
    offset: 0,
    text: "Hello",
  });

  ({ draft } = applyDraftUpdate(draft, {
    task_id: "t",
    message_id: "m1",
    offset: 5,
    text: " world",
  }));

  assert.deepEqual(draft, { task: "t", message_id: "m1", text: "Hello world" });

  // A gap means an update was missed.
  assert.deepEqual(
    applyDraftUpdate(draft, {
      task_id: "t",
      message_id: "m1",
      offset: 20,
      text: "!",
    }),
    { draft, stale: true },
  );

  // Another message's clear leaves this one.
  assert.equal(
    applyDraftUpdate(draft, { task_id: "t", message_id: "m0", cleared: true })
      .draft,
    draft,
  );

  assert.equal(
    applyDraftUpdate(draft, { task_id: "t", message_id: "m1", cleared: true })
      .draft,
    undefined,
  );

  assert.deepEqual(
    applyDraftUpdate(draft, {
      task_id: "t",
      message_id: "m2",
      offset: 0,
      text: "Next",
    }).draft,
    { task: "t", message_id: "m2", text: "Next" },
  );
});

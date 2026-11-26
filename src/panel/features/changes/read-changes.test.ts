import assert from "node:assert/strict";

import { test } from "vitest";

import type { Task } from "../tasks/types";
import { changesKey, changesStale, readChangedFile } from "./read-changes";

test("changes reload for another task or a new status or turn, not mid-read", () => {
  const task = { id: "one", status: "running", turn: 1 } as Task;

  const state = {
    task: "one",
    scope: "task" as const,
    key: changesKey(task),
    loading: false,
  };

  assert.equal(changesStale(undefined, task), true);
  assert.equal(changesStale(state, task), false);
  assert.equal(changesStale({ ...state, task: "two" }, task), true);
  assert.equal(changesStale(state, { ...task, turn: 2 }), true);
  assert.equal(changesStale(state, { ...task, status: "completed" }), true);

  assert.equal(
    changesStale({ ...state, loading: true }, { ...task, turn: 2 }),
    false,
  );
});

test("a changed file's parts are joined; a deleted file has no content", async () => {
  const parts = [
    {
      path: "a",
      state: "present" as const,
      size: 6,
      content: "abc",
      next_cursor: "1",
    },
    { path: "a", state: "present" as const, size: 6, content: "def" },
  ];

  assert.deepEqual(
    await readChangedFile("task", "a", async (args) => {
      const part = parts[Number(args.cursor ?? 0)];
      assert.ok(part, `no part for cursor ${String(args.cursor)}`);

      return part;
    }),
    { path: "a", state: "present", size: 6, content: "abcdef" },
  );

  assert.deepEqual(
    await readChangedFile("task", "b", async () => ({
      path: "b",
      state: "deleted",
      size: 0,
    })),
    { path: "b", state: "deleted", size: 0 },
  );
});

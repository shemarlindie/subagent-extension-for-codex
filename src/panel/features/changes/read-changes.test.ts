import assert from "node:assert/strict";

import { test } from "vitest";

import type { Task } from "../tasks/types";
import {
  changesKey,
  changesStale,
  readChangedFile,
  readChanges,
} from "./read-changes";
import type { Changes } from "./types";

const page = (diff: string, next_cursor?: string): Changes => ({
  scope: "task",
  files: [],
  additions: 3,
  deletions: 1,
  diff,
  ...(next_cursor ? { next_cursor } : {}),
});

test("pages are read in order and merged into one diff", async () => {
  const pages = [page("a", "1"), page("b", "2"), page("c")];
  const cursors: unknown[] = [];

  const merged = await readChanges(
    "task",
    "turn",
    async (args) => {
      cursors.push(args.cursor);

      const next = pages[Number(args.cursor ?? 0)];
      assert.ok(next, `no page for cursor ${String(args.cursor)}`);

      return next;
    },
    () => true,
  );

  assert.deepEqual(cursors, [undefined, "1", "2"]);
  assert.deepEqual(merged, { ...page("abc") });
});

test("a read that is no longer wanted stops between pages", async () => {
  let reads = 0;

  const merged = await readChanges(
    "task",
    "task",
    async () => (reads++, page("a", "1")),
    () => reads < 1,
  );

  assert.equal(merged, undefined);
  assert.equal(reads, 1);
});

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

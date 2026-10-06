import assert from "node:assert/strict";

import { test } from "vitest";

import type { Task } from "../tasks/types";
import {
  changesKey,
  changesStale,
  changesSummary,
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
  const pages = [page("a", "1"), page("b", "2"), page("c")],
    cursors: unknown[] = [];

  const merged = await readChanges(
    "task",
    "turn",
    async (args) => {
      cursors.push(args.cursor);

      return pages[Number(args.cursor ?? 0)];
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
  const task = { id: "one", status: "running", attempt: 1 } as Task,
    state = {
      task: "one",
      scope: "task" as const,
      key: changesKey(task),
      loading: false,
    };

  assert.equal(changesStale(undefined, task), true);
  assert.equal(changesStale(state, task), false);
  assert.equal(changesStale({ ...state, task: "two" }, task), true);
  assert.equal(changesStale(state, { ...task, attempt: 2 }), true);
  assert.equal(changesStale(state, { ...task, status: "completed" }), true);

  assert.equal(
    changesStale({ ...state, loading: true }, { ...task, attempt: 2 }),
    false,
  );
});

test("summaries count lines and files", () => {
  assert.equal(changesSummary(page("")), "+3 −1, 0 files");

  assert.equal(
    changesSummary({
      ...page(""),
      files: [
        {
          path: "a",
          status: "added",
          additions: 3,
          deletions: 1,
          binary: false,
        },
      ],
    }),
    "+3 −1, 1 file",
  );
});

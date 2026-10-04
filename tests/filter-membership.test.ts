import assert from "node:assert/strict";
import { test } from "vitest";
import { startSchema } from "../src/core/model.js";
import { filterCounts, visibleTasks } from "../ui/core/selectors";
import type { Filter, Snapshot, Task } from "../ui/core/types";

const task = (patch: Partial<Task>): Task => ({
  ...startSchema.parse({
    title: "t",
    description: "t",
    worker_profile: "reviewer",
  }),
  id: "t",
  title: "t",
  owner: "o",
  repository: "/repo",
  status: "running",
  created_at: "",
  updated_at: "",
  instructions: [],
  attempt: 1,
  runtime_ms: 0,
  ...patch,
});

const input = { id: "i", tool: "AskUserQuestion", input: {} };

const cases: [string, Partial<Task>, Filter[]][] = [
  ["running", { status: "running" }, ["all", "active"]],
  ["queued", { status: "queued" }, ["all", "active"]],
  [
    "dependency",
    { status: "waiting", waiting_reason: "waiting_for_dependency" },
    ["all", "active"],
  ],
  [
    "rate limit",
    {
      live_activity: { text: "Waiting for rate limit reset", state: "info" },
    },
    ["all", "active"],
  ],
  [
    "pending input",
    {
      status: "waiting",
      waiting_reason: "waiting_for_user",
      pending_input: input,
    },
    ["all", "active", "attention"],
  ],
  ["interrupted", { status: "interrupted" }, ["all", "failed"]],
  [
    "unconfirmed shutdown",
    { status: "waiting", waiting_reason: "termination_unconfirmed" },
    ["all", "failed"],
  ],
  [
    "compaction failed",
    { live_activity: { text: "Context compaction failed", state: "failed" } },
    ["all", "failed"],
  ],
  ["failed", { status: "failed" }, ["all", "failed"]],
  ["completed", { status: "completed" }, ["all", "completed"]],
  ["cancelled", { status: "cancelled" }, ["all"]],
] as never;

test("each task state appears only in its own filter besides All", () => {
  for (const [name, patch, expected] of cases) {
    const found = (
      ["all", "active", "attention", "completed", "failed"] as Filter[]
    ).filter(
      (filter) =>
        visibleTasks({
          tasks: [task(patch)],
          filter,
          search: "",
        } as unknown as Snapshot).length === 1,
    );

    assert.deepEqual(found, expected, name);
  }
});

test("filter counts match each filter's list and follow search and scope", () => {
  const tasks = [
    task({ id: "a", title: "alpha", status: "running" }),
    task({ id: "b", title: "beta", status: "failed" }),
    task({ id: "c", title: "alpha two", status: "completed" }),
    task({ id: "d", title: "other", repository: "/elsewhere" }),
  ];

  const state = (patch: object) =>
    ({
      tasks,
      filter: "all",
      search: "",
      repository: "/repo",
      ...patch,
    }) as unknown as Snapshot;

  const counts = filterCounts(state({}));

  assert.deepEqual(counts, {
    all: 3,
    active: 1,
    attention: 0,
    completed: 1,
    failed: 1,
  });

  for (const filter of Object.keys(counts) as Filter[])
    assert.equal(counts[filter], visibleTasks(state({ filter })).length);

  // Search narrows every count, but the selected filter does not.
  assert.deepEqual(filterCounts(state({ search: "alpha", filter: "failed" })), {
    all: 2,
    active: 1,
    attention: 0,
    completed: 1,
    failed: 0,
  });
});

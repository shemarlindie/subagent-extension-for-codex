import assert from "node:assert/strict";

import { test } from "vitest";

import { startSchema } from "../../../../shared/tasks/model.js";
import {
  effectiveFilter,
  filterCounts,
  GROUP_ROW_LIMIT,
  groupRows,
  showsReadCompleted,
  visibleTasks,
} from "../../../app/state/selectors";
import type { Filter, Snapshot, Task } from "../../../app/state/types";

const task = (patch: Partial<Task>): Task => ({
  ...startSchema.parse({
    repository: "/repo",
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
  created_by: "user",
  instructions_sent: 0,
  pending_steers: [],
  queue: [],
  turn: 1,
  runtime_ms: 0,
  ...patch,
});

const input = {
  kind: "question" as const,
  id: "i",
  tool: "AskUserQuestion",
  input: {},
};

const cases: [string, Partial<Task>, Filter[]][] = [
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
    "compaction failed",
    { live_activity: { text: "Context compaction failed", state: "failed" } },
    ["all", "failed"],
  ],
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
    task({
      id: "old",
      title: "alpha",
      status: "completed",
      archived_at: "then",
      unread: true,
    }),
  ];

  const state = (patch: object) =>
    ({
      tasks,
      filter: null,
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
    unread: 0,
  });

  for (const filter of Object.keys(counts) as Filter[]) {
    assert.equal(counts[filter], visibleTasks(state({ filter })).length);
  }

  // Search narrows every count, but the selected filter does not.
  assert.deepEqual(filterCounts(state({ search: "alpha", filter: "failed" })), {
    all: 2,
    active: 1,
    attention: 0,
    completed: 1,
    failed: 0,
    unread: 0,
  });
});

test("Done and All count read completed tasks the list left out, and load them once shown", () => {
  const state = (patch: object) =>
    ({
      tasks: [task({ id: "a", status: "running" })],
      readCompleted: { "/repo": 2, "/elsewhere": 5 },
      filter: null,
      search: "",
      repository: "/repo",
      taskListLoading: false,
      ...patch,
    }) as unknown as Snapshot;

  assert.deepEqual(filterCounts(state({})), {
    all: 3,
    active: 1,
    attention: 0,
    completed: 2,
    failed: 0,
    unread: 0,
  });

  assert.equal(filterCounts(state({ repository: undefined })).completed, 7);
  // A search loads them, so it counts only what it matches.
  assert.equal(filterCounts(state({ search: "t" })).completed, 0);

  assert.equal(showsReadCompleted(state({})), false);
  assert.equal(showsReadCompleted(state({ filter: "completed" })), true);
  assert.equal(showsReadCompleted(state({ search: "t" })), true);

  // With nothing else, the default filter is Done, but only once it's known.
  const onlyUnloaded = { tasks: [] };
  assert.equal(effectiveFilter(state(onlyUnloaded)), "completed");
  assert.equal(showsReadCompleted(state(onlyUnloaded)), true);

  assert.equal(
    showsReadCompleted(state({ ...onlyUnloaded, taskListLoading: true })),
    false,
  );
});

test("the filter follows the first nonempty one in order until chosen", () => {
  const state = (tasks: Task[], patch: object = {}) =>
    ({
      tasks,
      filter: null,
      search: "",
      ...patch,
    }) as unknown as Snapshot;

  const running = task({ id: "a", status: "running" }),
    failed = task({ id: "b", status: "failed" }),
    done = task({ id: "c", status: "completed" }),
    asking = task({ id: "d", pending_input: input });

  assert.equal(effectiveFilter(state([])), "all");
  assert.equal(effectiveFilter(state([done])), "completed");
  assert.equal(effectiveFilter(state([done, running])), "active");
  assert.equal(effectiveFilter(state([done, running, failed])), "failed");
  assert.equal(effectiveFilter(state([done, failed, asking])), "attention");

  // A chosen filter wins, even when it is empty.
  assert.equal(
    effectiveFilter(state([asking], { filter: "failed" })),
    "failed",
  );

  assert.equal(effectiveFilter(state([asking], { filter: "all" })), "all");
});

test("Unread cuts across the status filters and keeps the open task listed", () => {
  const state = (patch: object) =>
    ({
      tasks: [
        task({ id: "a", status: "completed", unread: true }),
        task({ id: "b", status: "failed", unread: true }),
        task({ id: "c", status: "running" }),
      ],
      filter: "unread",
      search: "",
      ...patch,
    }) as unknown as Snapshot;

  assert.equal(filterCounts(state({})).unread, 2);

  assert.deepEqual(
    visibleTasks(state({})).map((task) => task.id),
    ["a", "b"],
  );

  // The task being read stays until another is chosen, but isn't counted.
  assert.deepEqual(
    visibleTasks(state({ selected: "c" })).map((task) => task.id),
    ["a", "b", "c"],
  );

  // It is never chosen by default, since reading tasks empties it.
  assert.equal(effectiveFilter(state({ filter: null })), "failed");
});

test("across projects, visible tasks come grouped by project in list order", () => {
  const state = (patch: object) =>
    ({
      tasks: [
        task({ id: "a1", repository: "/a" }),
        task({ id: "b1", repository: "/b" }),
        task({ id: "a2", repository: "/a" }),
      ],
      filter: "all",
      search: "",
      ...patch,
    }) as unknown as Snapshot;

  assert.deepEqual(
    visibleTasks(state({})).map((task) => task.id),
    ["a1", "a2", "b1"],
  );

  assert.deepEqual(
    visibleTasks(state({ repository: "/a" })).map((task) => task.id),
    ["a1", "a2"],
  );
});

test("a long group stops at the row limit and keeps the selected task shown", () => {
  const tasks = Array.from({ length: 9 }, (_, index) =>
    task({ id: `t${index}` }),
  );

  const ids = (rows: { shown: Task[]; hidden: Task[] }) => ({
    shown: rows.shown.map((task) => task.id),
    hidden: rows.hidden.map((task) => task.id),
  });

  assert.deepEqual(ids(groupRows(tasks)), {
    shown: ["t0", "t1", "t2", "t3", "t4"],
    hidden: ["t5", "t6", "t7", "t8"],
  });

  assert.deepEqual(ids(groupRows(tasks, "t7")), {
    shown: ["t0", "t1", "t2", "t3", "t4", "t7"],
    hidden: ["t5", "t6", "t8"],
  });

  // When only one row would hide, the group shows it.
  assert.equal(groupRows(tasks.slice(0, GROUP_ROW_LIMIT + 1)).hidden.length, 0);
  assert.equal(groupRows(tasks.slice(0, 7), "t6").hidden.length, 0);
});

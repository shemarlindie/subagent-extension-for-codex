import assert from "node:assert/strict";

import { test } from "vitest";

import { startSchema, type Task } from "../../../../src/shared/contracts.js";
import { formatDuration, runtimeLive, taskRuntimeMs } from "./duration";

test("durations read compactly at each scale", () => {
  assert.equal(formatDuration(-5), "0s");
  assert.equal(formatDuration(45_900), "45s");
  assert.equal(formatDuration(185_000), "3m 05s");
  assert.equal(formatDuration(3_720_000), "1h 02m");
});

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
  runtime_ms: 60_000,
  ...patch,
});

test("a running task adds its current run to finished runtime", () => {
  const started = Date.parse("2026-10-02T08:00:00Z");
  const running = task({ run_started_at: new Date(started).toISOString() });
  assert.equal(runtimeLive(running), true);
  assert.equal(taskRuntimeMs(running, started + 30_000), 90_000);
  // A clock behind the server never yields negative time.
  assert.equal(taskRuntimeMs(running, started - 5_000), 60_000);
});

test("a stopped task reports only recorded runtime", () => {
  const stale = task({
    status: "completed",
    run_started_at: "2026-10-02T08:00:00Z",
  });

  assert.equal(runtimeLive(stale), false);
  assert.equal(taskRuntimeMs(stale, Date.now()), 60_000);
});

test("a run held for input freezes at the request time and resumes against the same start", () => {
  const started = Date.parse("2026-10-02T08:00:00Z");

  const waiting = task({
    status: "waiting",
    run_started_at: new Date(started).toISOString(),
    updated_at: new Date(started + 30_000).toISOString(),
    pending_input: { id: "question", tool: "AskUserQuestion", input: {} },
  });

  assert.equal(runtimeLive(waiting), false);
  assert.equal(taskRuntimeMs(waiting, started + 30_000), 90_000);
  assert.equal(taskRuntimeMs(waiting, started + 90_000), 90_000);

  const resumed = {
    ...waiting,
    status: "running" as const,
    pending_input: undefined,
  };

  assert.equal(runtimeLive(resumed), true);
  assert.equal(taskRuntimeMs(resumed, started + 90_000), 150_000);

  assert.equal(
    taskRuntimeMs({ ...waiting, updated_at: "" }, started + 90_000),
    60_000,
  );
});

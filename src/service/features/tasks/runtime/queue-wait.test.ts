import { expect, onTestFinished, test, vi } from "vitest";

import { QueueWaits } from "./queue-wait.js";
import { captureTiming } from "./timing-test-harness.js";

async function setup() {
  const timing = await captureTiming();
  vi.useFakeTimers({ toFake: ["performance"] });
  onTestFinished(() => void vi.useRealTimers());

  return {
    waits: new QueueWaits(),
    timing,
    step: (ms: number) => vi.advanceTimersByTime(ms),
  };
}

test("a dependency that finishes while slots are full stays counted in observation and capacity time", async () => {
  const { waits, timing, step } = await setup();

  waits.queued("task-b", "start");
  step(10);
  // The only scan to reach B finds its dependency running.
  waits.dependencyPending("task-b");
  step(10);
  waits.capacity(true);
  // The dependency finishes here, unobserved: the scheduler stops at capacity.
  step(30);
  waits.capacity(false);
  waits.ended("task-b", "success", 1);

  expect(await timing.records("queue_wait")).toEqual([
    expect.objectContaining({
      task_id: "task-b",
      turn: 1,
      cause: "start",
      outcome: "success",
      duration_ms: 50,
      capacity_ms: 30,
      dependency_observation_span_ms: 0,
      since_dependency_observed_ms: 40,
    }),
  ]);
});

test("capacity time counts only the full periods inside each wait", async () => {
  const { waits, timing, step } = await setup();

  waits.capacity(true);
  step(5);
  waits.queued("task-a", "followup");
  step(10);
  waits.capacity(false);
  step(10);
  waits.capacity(true);
  waits.queued("task-b", "resume");
  step(5);
  waits.dependencyPending("task-b");
  step(5);
  waits.dependencyPending("task-b");
  // A second queued() keeps the first wait and its cause.
  waits.queued("task-b", "queued_message");
  waits.ended("task-a", "success", 2);
  step(5);
  waits.capacity(false);
  waits.ended("task-b", "aborted");
  // Each wait is recorded once; later calls for an ended wait do nothing.
  waits.ended("task-b", "aborted");
  waits.dependencyPending("task-b");

  const [a, b] = await timing.records("queue_wait");

  expect(a).toMatchObject({
    cause: "followup",
    duration_ms: 30,
    capacity_ms: 20,
  });

  expect(a?.dependency_observation_span_ms).toBeUndefined();

  expect(b).toMatchObject({
    cause: "resume",
    outcome: "aborted",
    duration_ms: 15,
    capacity_ms: 15,
    dependency_observation_span_ms: 5,
    since_dependency_observed_ms: 10,
  });

  expect(b?.turn).toBeUndefined();
});

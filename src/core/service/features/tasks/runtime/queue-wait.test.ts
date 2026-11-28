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
  step(10);
  // A second queued() keeps the first wait and its cause.
  waits.queued("task-b", "queued_message");
  waits.ended("task-a", "success", 2);
  step(5);
  waits.capacity(false);
  waits.ended("task-b", "aborted");
  // Each wait is recorded once; later calls for an ended wait do nothing.
  waits.ended("task-b", "aborted");

  const [a, b] = await timing.records("queue_wait");

  expect(a).toMatchObject({
    cause: "followup",
    duration_ms: 30,
    capacity_ms: 20,
  });

  expect(b).toMatchObject({
    cause: "resume",
    outcome: "aborted",
    duration_ms: 15,
    capacity_ms: 15,
  });

  expect(b?.turn).toBeUndefined();
});

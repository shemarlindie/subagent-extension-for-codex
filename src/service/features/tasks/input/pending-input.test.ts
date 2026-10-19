import { expect, onTestFinished, test, vi } from "vitest";

import type { Task } from "../../../../shared/tasks/model.js";
import type { ProviderTaskPolicy } from "../../providers/task-policy.js";
import { captureTiming } from "../runtime/timing-test-harness.js";
import type { Store } from "../storage/store.js";
import { PendingInput } from "./pending-input.js";

/** Lets pending requests take their turn without moving the clock. */
async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function setup() {
  const timing = await captureTiming();
  vi.useFakeTimers({ toFake: ["performance"] });
  onTestFinished(() => void vi.useRealTimers());
  const task = { id: "task-1", turn: 2, status: "running" } as Task;

  const store = {
    transaction: (write: () => void) => write(),
    save: () => {},
    event: () => {},
  } as unknown as Store;

  const policy = {
    inputKind: () => "permission",
    decideInput: () => undefined,
  } as unknown as ProviderTaskPolicy;

  const input = new PendingInput(
    task,
    store,
    policy,
    new AbortController().signal,
  );

  return { input, timing, step: (ms: number) => vi.advanceTimersByTime(ms) };
}

test("a queued request aborted behind a shown one keeps the shown request's wait", async () => {
  const { input, timing, step } = await setup();
  const first = input.request("Bash", {}, undefined);
  const abort = new AbortController();
  const second = input.request("Bash", {}, abort.signal);
  await settle();
  expect(input.waiting).toBe(true);

  step(10);
  abort.abort();
  await expect(second).rejects.toThrow("Input interrupted");
  expect(input.waitedMs).toBe(10);

  step(20);
  input.submit({ approved: true });
  await expect(first).resolves.toEqual({ approved: true });
  expect(input.waitedMs).toBe(30);

  expect(await timing.records("input_wait")).toEqual([
    expect.objectContaining({
      task_id: "task-1",
      turn: 2,
      input_kind: "permission",
      outcome: "aborted",
      duration_ms: 0,
      queued_ms: 10,
    }),
    expect.objectContaining({
      outcome: "success",
      duration_ms: 30,
      queued_ms: 0,
    }),
  ]);
});

test("serialized requests add their user waits without overlap", async () => {
  const { input, timing, step } = await setup();
  const first = input.request("Bash", {}, undefined);
  const second = input.request("Bash", {}, undefined);
  await settle();
  expect(input.waiting).toBe(true);

  step(5);
  input.submit({ approved: true });
  await first;
  // The next request is shown once the first one's slot is released.
  await settle();
  expect(input.waiting).toBe(true);
  step(7);
  input.submit({ approved: false });
  await second;

  expect(input.waitedMs).toBe(12);

  expect(
    (await timing.records("input_wait")).map(({ duration_ms, queued_ms }) => ({
      duration_ms,
      queued_ms,
    })),
  ).toEqual([
    { duration_ms: 5, queued_ms: 0 },
    { duration_ms: 7, queued_ms: 5 },
  ]);
});

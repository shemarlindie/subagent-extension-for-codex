import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { deferred, flush, setup } from "./controller-test-harness";
import type { Task } from "./types";

for (const phase of ["connect", "read", "poll"] as const) {
  test(`host teardown during ${phase} stops further reads and refreshes`, async (t) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    t.onTestFinished(() => {
      vi.useRealTimers();
    });

    const { controller, transport } = setup();
    t.onTestFinished(() => controller.dispose());
    const gate = deferred<void>();
    if (phase === "connect") transport.connectGate = gate.promise;

    if (phase === "read") {
      transport.handler = (name) =>
        name === "list_workers" ? gate.promise.then(() => []) : undefined;
    }

    const starting = controller.start();
    await flush();

    if (phase === "poll") {
      await starting;

      transport.handler = (name) =>
        name === "list_tasks" ? gate.promise.then(() => []) : undefined;

      vi.advanceTimersByTime(30000);
      await flush();
    }

    transport.events.teardown();
    const calls = transport.calls.length;
    gate.resolve();
    await starting;
    await flush();
    vi.advanceTimersByTime(30000);
    await flush();
    assert.equal(transport.calls.length, calls);
    assert.equal(transport.watches, phase === "poll" ? 1 : 0);
    assert.equal(transport.disposals, 1);
    await assert.rejects(controller.tool("list_tasks"), /closed/);
  });
}

test("the fallback refresh skips hidden panels and waits for a pending refresh", async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  const { controller, transport, environment } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  let hidden = true;
  environment.hidden = () => hidden;

  const reads = () =>
    transport.calls.filter((call) => call.name !== "app_record_timing").length;

  const initial = reads();
  vi.advanceTimersByTime(30000);
  await flush();
  assert.equal(reads(), initial);
  hidden = false;
  const gate = deferred<Task[]>();

  transport.handler = (name) =>
    name === "list_tasks" ? gate.promise : undefined;

  vi.advanceTimersByTime(30000);
  await flush();
  const pending = reads();
  // Each refresh reads the project list, then the tasks.
  assert.equal(pending, initial + 2);
  vi.advanceTimersByTime(60000);
  await flush();
  assert.equal(reads(), pending);
  gate.resolve([]);
  await flush();
  vi.advanceTimersByTime(30000);
  await flush();
  assert.equal(reads(), pending + 2);
});

test("the fallback refresh reports tool failures then retries successfully", async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  let fails = true;

  transport.handler = (name) =>
    name === "list_tasks" && fails
      ? Promise.reject(new Error("Host temporarily unavailable"))
      : undefined;

  vi.advanceTimersByTime(30000);
  await flush();
  assert.equal(controller.getSnapshot().connection, "Reconnecting…");
  assert.match(controller.getSnapshot().error, /temporarily unavailable/);
  fails = false;
  vi.advanceTimersByTime(30000);
  await flush();

  assert.equal(controller.getSnapshot().connection, "Connected");

  assert.equal(controller.getSnapshot().error, "");
});

test("embedded startup schedules a retry when its first read fails", async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  let fails = true;

  transport.handler = (name) =>
    name === "list_tasks" && fails
      ? Promise.reject(new Error("Host temporarily unavailable"))
      : undefined;

  await controller.start();
  assert.equal(controller.getSnapshot().connection, "Reconnecting…");
  assert.match(controller.getSnapshot().error, /temporarily unavailable/);
  assert.equal(transport.watches, 0);

  fails = false;

  const previousReads = transport.calls.filter(
    (call) => call.name === "list_tasks",
  ).length;

  vi.advanceTimersByTime(30000);
  await flush();

  assert.equal(
    transport.calls.filter((call) => call.name === "list_tasks").length,
    previousReads + 1,
  );

  assert.equal(controller.getSnapshot().connection, "Connected");

  assert.equal(controller.getSnapshot().error, "");
});

test("workers are read again each refresh while one can't start tasks, and otherwise each hour", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());

  let ready = false;

  transport.handler = (name) =>
    name === "list_workers"
      ? [
          {
            provider: "claude",
            profiles: ["reviewer"],
            capabilities: {},
            readiness: ready
              ? { ready: true, details: {} }
              : { ready: false, message: "Claude Code not found", details: {} },
          },
        ]
      : undefined;

  const workerReads = () =>
    transport.calls.filter((call) => call.name === "list_workers").length;

  await controller.start();
  await controller.refresh();
  assert.equal(workerReads(), 2);

  ready = true;
  await controller.refresh();
  assert.equal(workerReads(), 3);
  const [readyWorker] = controller.getSnapshot().workers;
  assert.ok(readyWorker);
  assert.equal(readyWorker.readiness?.ready, true);

  await controller.refresh();
  assert.equal(workerReads(), 3);

  // Within the hour, a ready list is reused.
  const start = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(start + 59 * 60_000);
  await controller.refresh();
  assert.equal(workerReads(), 3);
  clock.mockRestore();

  // A ready list is still read again after an hour, so a runtime that breaks shows.
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 60 * 60_000 + 1000);
  ready = false;
  await controller.refresh();
  assert.equal(workerReads(), 4);
  const [brokenWorker] = controller.getSnapshot().workers;
  assert.ok(brokenWorker);
  assert.equal(brokenWorker.readiness?.ready, false);
});

test("a new revision refreshes a visible panel, and a hidden one once it is shown", async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  const { controller, transport, environment } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();

  const reads = () =>
    transport.calls.filter((call) => call.name === "list_tasks").length;

  const initial = reads();
  transport.events.revision("boot:1");
  vi.advanceTimersByTime(100);
  await flush();
  assert.equal(reads(), initial + 1);

  environment.setHidden(true);
  transport.events.revision("boot:2");
  vi.advanceTimersByTime(100);
  await flush();
  assert.equal(reads(), initial + 1);
  environment.setHidden(false);
  await flush();
  assert.equal(reads(), initial + 2);
});

test("each completed refresh restarts the fallback wait", async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();

  const reads = () =>
    transport.calls.filter((call) => call.name === "list_tasks").length;

  const initial = reads();
  vi.advanceTimersByTime(20000);
  await controller.refresh();
  vi.advanceTimersByTime(20000);
  await flush();
  assert.equal(reads(), initial + 1);
  vi.advanceTimersByTime(10000);
  await flush();
  assert.equal(reads(), initial + 2);
});

test("a refresh leaves the connection status the transport reports", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  assert.equal(controller.getSnapshot().connection, "Connected");

  transport.events.status("Connected");
  await controller.refresh();
  assert.equal(controller.getSnapshot().connection, "Connected");

  transport.handler = (name) =>
    name === "list_tasks"
      ? Promise.reject(new Error("Host temporarily unavailable"))
      : undefined;

  await assert.rejects(controller.refresh(), /temporarily unavailable/);
  assert.equal(controller.getSnapshot().connection, "Connected");
});

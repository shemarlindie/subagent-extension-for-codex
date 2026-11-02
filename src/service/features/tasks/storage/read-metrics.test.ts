import { performance } from "node:perf_hooks";

import { expect, test, vi } from "vitest";

import * as logging from "../../../platform/logging/logger.js";
import { ReadMetrics } from "./read-metrics.js";

test("read windows aggregate actual work, slow reads and failures and stay silent when idle", (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const log = vi.spyOn(logging, "logEvent").mockImplementation(() => {});
  const metrics = new ReadMetrics();

  t.onTestFinished(() => {
    metrics.flush();
    vi.useRealTimers();
  });

  expect(
    metrics.rows("task_list", () => {
      clock += 49;

      return ["first", "second"];
    }),
  ).toEqual(["first", "second"]);

  metrics.rows("chat", () => {
    clock += 50;

    return [1, 2, 3];
  });

  const failure = new Error("read failed");

  expect(() =>
    metrics.rows("task_list", () => {
      clock += 70;
      throw failure;
    }),
  ).toThrow(failure);

  expect(log.mock.calls.filter(([level]) => level === "info")).toEqual([]);
  clock = 60_049;
  vi.advanceTimersByTime(60_000);

  const summaries = log.mock.calls.filter(
    ([, event]) => event === "storage.read_summary",
  );

  expect(summaries).toEqual([
    [
      "info",
      "storage.read_summary",
      {
        operation: "task_list",
        count: 2,
        total_ms: 119,
        max_ms: 70,
        rows: 2,
        tally_rows: 0,
        slow_count: 1,
        error_count: 1,
        window_ms: 60_000,
        slow_threshold_ms: 50,
      },
    ],
    [
      "info",
      "storage.read_summary",
      {
        operation: "chat",
        count: 1,
        total_ms: 50,
        max_ms: 50,
        rows: 3,
        tally_rows: 0,
        slow_count: 1,
        error_count: 0,
        window_ms: 60_000,
        slow_threshold_ms: 50,
      },
    ],
  ]);

  vi.advanceTimersByTime(120_000);
  metrics.flush();

  expect(
    log.mock.calls.filter(([, event]) => event === "storage.read_summary"),
  ).toHaveLength(2);

  // A fixed operation accumulates work without retaining one entry per poll.
  for (let index = 0; index < 1000; index++) {
    metrics.measure("activity_latest", (work) => {
      work.rows = 1;
      work.tally_rows = 2;
      work.cache = "hit";
      clock += 1;
    });
  }

  expect(vi.getTimerCount()).toBe(1);
  metrics.flush();
  expect(vi.getTimerCount()).toBe(0);

  expect(log).toHaveBeenLastCalledWith("info", "storage.read_summary", {
    operation: "activity_latest",
    count: 1000,
    total_ms: 1000,
    max_ms: 1,
    rows: 1000,
    tally_rows: 2000,
    slow_count: 0,
    error_count: 0,
    window_ms: 999,
    slow_threshold_ms: 50,
  });
});

test("logging failures preserve read results and errors and release flushed windows", () => {
  const log = vi.spyOn(logging, "logEvent").mockImplementation(() => {
    throw new Error("logging unavailable");
  });

  const metrics = new ReadMetrics();
  expect(metrics.rows("task_list", () => [1])).toEqual([1]);
  const failure = new Error("read failed");

  expect(() =>
    metrics.rows("chat", () => {
      throw failure;
    }),
  ).toThrow(failure);

  expect(() => metrics.flush()).not.toThrow();
  log.mockReset();
  metrics.flush();
  expect(log).not.toHaveBeenCalled();
});

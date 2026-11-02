import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { expect, test, vi } from "vitest";

import * as logging from "./logger.js";
import { configureLogging, flushLogs } from "./logger.js";
import { startRuntimeMetrics } from "./runtime-metrics.js";

test("samples bounded resource metrics and stops sampling on cleanup", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "runtime-metrics-"));
  const path = join(directory, "resources.jsonl");
  configureLogging(path);
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const activeTasks = vi.fn(() => 2);
  const stop = startRuntimeMetrics(activeTasks);

  t.onTestFinished(async () => {
    stop();
    vi.useRealTimers();
    await flushLogs();
    configureLogging(undefined);
    await rm(directory, { recursive: true, force: true });
  });

  vi.advanceTimersByTime(60_000);
  await flushLogs();
  const text = await readFile(path, "utf8");
  const record: Record<string, unknown> = JSON.parse(text);

  for (const field of [
    "rss_bytes",
    "heap_used_bytes",
    "external_bytes",
    "event_loop_utilization",
    "event_loop_p99_ms",
    "event_loop_max_ms",
    "cpu_user_ms",
    "cpu_system_ms",
    "interval_ms",
  ]) {
    expect(record[field]).toEqual(expect.any(Number));
    expect(record[field]).toBeGreaterThanOrEqual(0);
  }

  expect(record.event_loop_utilization).toBeLessThanOrEqual(1);
  expect(activeTasks).toHaveBeenCalledTimes(1);
  stop();
  vi.advanceTimersByTime(120_000);
  await flushLogs();
  expect(activeTasks).toHaveBeenCalledTimes(1);
  expect(await readFile(path, "utf8")).toBe(text);
});

test("resource intervals follow the monotonic sample clock when sampling is delayed", (t) => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let clock = 100;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const log = vi.spyOn(logging, "logEvent").mockImplementation(() => {});
  const stop = startRuntimeMetrics(() => 0);

  t.onTestFinished(() => {
    stop();
    vi.useRealTimers();
  });

  clock += 60_000;
  vi.advanceTimersByTime(60_000);
  clock += 95_000;
  vi.advanceTimersByTime(60_000);

  expect(log.mock.calls.map(([, , fields]) => fields?.interval_ms)).toEqual([
    60_000, 95_000,
  ]);
});

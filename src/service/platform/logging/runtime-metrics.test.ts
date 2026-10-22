import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, vi } from "vitest";

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

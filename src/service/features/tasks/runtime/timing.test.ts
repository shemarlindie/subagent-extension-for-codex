import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { onTestFinished, test, vi } from "vitest";

import {
  configureTimingLog,
  flushTimingLog,
  measureTaskWait,
  measureTaskWrite,
  recordTaskTiming,
} from "./timing.js";

test("timing records go to a private JSON Lines file, not the console", async () => {
  const directory = await mkdtemp(join(tmpdir(), "task-timing-"));
  const path = join(directory, "timing.jsonl");
  const debug = vi.spyOn(console, "debug");

  onTestFinished(async () => {
    configureTimingLog(undefined);
    debug.mockRestore();
    await rm(directory, { recursive: true, force: true });
  });

  configureTimingLog(path);

  assert.equal(
    measureTaskWrite("task-1", () => "stored"),
    "stored",
  );

  await measureTaskWait("repository_validation", "task-1", async () => {});

  await flushTimingLog();

  const records = (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  assert.deepEqual(
    records.map(({ event, phase, task_id }) => ({ event, phase, task_id })),
    [
      { event: "task.timing", phase: "send_storage", task_id: "task-1" },
      {
        event: "task.timing",
        phase: "repository_validation",
        task_id: "task-1",
      },
    ],
  );

  assert.equal(typeof records[0]?.duration_ms, "number");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(debug.mock.calls.length, 0);
});

test("a full timing log rolls over to one previous file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "task-timing-"));
  const path = join(directory, "timing.jsonl");

  onTestFinished(async () => {
    configureTimingLog(undefined);
    await rm(directory, { recursive: true, force: true });
  });

  configureTimingLog(path, 200);

  for (const phase of ["first", "second", "third"]) {
    recordTaskTiming({ phase, detail: "x".repeat(80) });
  }

  await flushTimingLog();

  const phases = async (file: string) =>
    (await readFile(file, "utf8"))
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as { phase: string }).phase);

  assert.deepEqual(await phases(`${path}.1`), ["second"]);
  assert.deepEqual(await phases(path), ["third"]);
});

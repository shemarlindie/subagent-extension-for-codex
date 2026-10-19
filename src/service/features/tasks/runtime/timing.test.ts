import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, onTestFinished, test, vi } from "vitest";

import {
  configureLogging,
  logCorrelation,
  withLogContext,
} from "../../../platform/logging/logger.js";
import {
  configureTimingLog,
  flushTimingLog,
  measureTaskWait,
  measureTaskWrite,
  recordTaskTiming,
  sendRef,
} from "./timing.js";
import { captureTiming } from "./timing-test-harness.js";

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
    measureTaskWrite({ task_id: "task-1" }, () => "stored"),
    "stored",
  );

  await measureTaskWait(
    "repository_validation",
    { task_id: "task-1" },
    async () => {},
  );

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

  configureTimingLog(path, 300);

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

test("timing records carry the service log's instance and request IDs", async () => {
  const timing = await captureTiming();
  configureLogging(undefined);
  onTestFinished(() => configureLogging(undefined));

  withLogContext({ request_id: "req-1", route: "/mcp", task_id: "t" }, () =>
    recordTaskTiming({ phase: "inside" }),
  );

  recordTaskTiming({ phase: "outside" });

  const [inside, outside] = await timing.records();

  assert.equal(inside?.instance_id, logCorrelation().instance_id);
  assert.equal(inside?.request_id, "req-1");
  // Only selected correlation fields come from the log context.
  assert.equal(inside?.route, undefined);
  assert.equal(inside?.task_id, undefined);
  assert.equal(outside?.instance_id, logCorrelation().instance_id);
  assert.equal(outside?.request_id, undefined);
});

test("send references are stable for retries and never hold the raw ID", () => {
  assert.equal(sendRef("my private request"), sendRef("my private request"));
  assert.notEqual(sendRef("one"), sendRef("two"));
  assert.match(sendRef("my private request") ?? "", /^[0-9a-f]{16}$/);
  assert.equal(sendRef(undefined), undefined);
});

test("measured phases report their outcome and rethrow the same error", async () => {
  const timing = await captureTiming();
  const failure = new Error("boom");

  const timeout = new Error("Git repository validation did not finish", {
    cause: Object.assign(new Error("Command failed"), { killed: true }),
  });

  const abort = new AbortController();
  abort.abort();

  const outcomes = [
    [failure, undefined],
    [timeout, undefined],
    [new Error("stopped"), abort.signal],
  ] as const;

  for (const [error, signal] of outcomes) {
    await expect(
      measureTaskWait(
        "workspace_preparation",
        { task_id: "task-1" },
        () => Promise.reject(error),
        {
          signal,
          detail: () => ({ workspace_action: "created" }),
          end: () => ({ input_wait_ms: 3 }),
        },
      ),
    ).rejects.toBe(error);
  }

  assert.throws(
    () =>
      measureTaskWrite({ task_id: "task-1" }, () => {
        throw failure;
      }),
    (error) => error === failure,
  );

  const records = await timing.records();

  assert.deepEqual(
    records.map(({ phase, outcome, workspace_action, input_wait_ms }) => ({
      phase,
      outcome,
      workspace_action,
      input_wait_ms,
    })),
    [
      ...["error", "timeout", "aborted"].map((outcome) => ({
        phase: "workspace_preparation",
        outcome,
        // A failed step's result can't describe it.
        workspace_action: undefined,
        input_wait_ms: 3,
      })),
      {
        phase: "send_storage",
        outcome: "error",
        workspace_action: undefined,
        input_wait_ms: undefined,
      },
    ],
  );
});

test("failing timing detail never replaces the measured result or error", async () => {
  await captureTiming();
  const failure = new Error("boom");

  const throwing = () => {
    throw new Error("detail failed");
  };

  assert.equal(
    await measureTaskWait("prompt_assembly", {}, async () => "prompt", {
      detail: throwing,
    }),
    "prompt",
  );

  await expect(
    measureTaskWait("prompt_assembly", {}, () => Promise.reject(failure), {
      end: throwing,
    }),
  ).rejects.toBe(failure);
});

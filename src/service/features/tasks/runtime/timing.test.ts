import assert from "node:assert/strict";

import { expect, test } from "vitest";

import { measureTaskWait, measureTaskWrite } from "./timing.js";
import { captureTiming } from "./timing-test-harness.js";

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

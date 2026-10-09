import assert from "node:assert/strict";

import { test } from "vitest";

import type { Task } from "../../../app/state/types";
import { composerMode, spentBudget } from "./chat-model";

const task = (patch: Partial<Task>) =>
  ({
    status: "completed",
    budget: { max_runtime_minutes: 20, max_cost_usd: 5 },
    runtime_ms: 60000,
    cost_usd: 1,
    pending_steers: [],
    queue: [],
    ...patch,
  }) as Task;

test("the composer starts a turn when idle, steers when busy and only queues while input waits", () => {
  assert.equal(composerMode(task({ status: "completed" })), "idle");
  assert.equal(composerMode(task({ status: "interrupted" })), "idle");
  assert.equal(composerMode(task({ status: "queued" })), "busy");
  assert.equal(composerMode(task({ status: "running" })), "busy");

  assert.equal(
    composerMode(
      task({
        status: "waiting",
        pending_input: { id: "r", tool: "Bash", kind: "permission", input: {} },
      }),
    ),
    "input",
  );
});

test("a spent budget shows the amounts used and allowed", () => {
  assert.equal(spentBudget(task({})), undefined);

  assert.deepEqual(spentBudget(task({ status: "failed", cost_usd: 5.2 })), {
    cost: { used: 5.2, allowed: 5 },
  });

  // Claude stops at its own estimate, a little under the limit.
  assert.deepEqual(
    spentBudget(
      task({
        status: "failed",
        cost_usd: 4.97,
        error: "Claude result: error_max_budget_usd",
      }),
    ),
    { cost: { used: 4.97, allowed: 5 } },
  );

  assert.deepEqual(
    spentBudget(
      task({
        status: "failed",
        runtime_ms: 20 * 60000,
        error: "Runtime budget exhausted",
      }),
    ),
    { runtime: { usedMinutes: 20, allowedMinutes: 20 } },
  );

  // A running task can't be raised from the composer.
  assert.equal(
    spentBudget(task({ status: "running", cost_usd: 9 })),
    undefined,
  );
});

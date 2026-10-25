import assert from "node:assert/strict";

import { test } from "vitest";

import { startSchema, type Task } from "../../../../shared/tasks/model";
import { spentBudget } from "./chat-model";

function failedBudgetTask(patch: Partial<Task> = {}): Task {
  return {
    ...startSchema.parse({
      repository: "/repo",
      description: "Continue the task",
      budget: { max_cost_usd: 2, max_runtime_minutes: 20 },
    }),
    id: "task-1",
    title: "Continue the task",
    owner: "owner",
    created_by: "user",
    status: "failed",
    error: "Cost and runtime budget exhausted",
    created_at: "",
    updated_at: "",
    instructions: [],
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 2,
    runtime_ms: 10 * 60_000,
    cost_usd: 1,
    ...patch,
  };
}

test("budget usage handles completed tasks, provider failures and spent limits", () => {
  assert.equal(
    spentBudget(
      failedBudgetTask({
        status: "completed",
        error: undefined,
      }),
    ),
    undefined,
  );

  assert.deepEqual(
    spentBudget(
      failedBudgetTask({
        error: "Claude result: error_max_budget_usd",
        cost_usd: 1.97,
      }),
    ),
    { cost: { used: 1.97, allowed: 2 } },
  );

  assert.deepEqual(
    spentBudget(
      failedBudgetTask({
        error: "Runtime budget exhausted",
        runtime_ms: 20 * 60_000,
      }),
    ),
    { runtime: { usedMinutes: 20, allowedMinutes: 20 } },
  );

  assert.equal(
    spentBudget(failedBudgetTask({ status: "running", cost_usd: 9 })),
    undefined,
  );
});

test("a raised budget clears only its matching failure for that turn", () => {
  const updated = failedBudgetTask({
    budget_raised_for_turn: { turn: 2, cost: true },
  });

  assert.deepEqual(spentBudget(updated), {
    runtime: { usedMinutes: 10, allowedMinutes: 20 },
  });

  const runtimeRaised = failedBudgetTask({
    budget_raised_for_turn: { turn: 2, runtime: true },
  });

  assert.deepEqual(spentBudget(runtimeRaised), {
    cost: { used: 1, allowed: 2 },
  });

  const laterTurn = failedBudgetTask({
    budget_raised_for_turn: { turn: 1, cost: true },
  });

  assert.deepEqual(spentBudget(laterTurn), {
    cost: { used: 1, allowed: 2 },
    runtime: { usedMinutes: 10, allowedMinutes: 20 },
  });

  const overNewLimit = failedBudgetTask({
    budget: { max_cost_usd: 2, max_runtime_minutes: 20 },
    budget_raised_for_turn: { turn: 2, cost: true },
    cost_usd: 2.5,
  });

  assert.deepEqual(spentBudget(overNewLimit), {
    cost: { used: 2.5, allowed: 2 },
    runtime: { usedMinutes: 10, allowedMinutes: 20 },
  });
});

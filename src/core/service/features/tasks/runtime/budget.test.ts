import assert from "node:assert/strict";

import { test } from "vitest";

import type { Capabilities } from "../../../../shared/providers/types.js";
import type { Task } from "../../../../shared/tasks/model.js";
import type { Provider } from "../../providers/types.js";
import { raiseBudget, raisedBudget, remainingRuntime } from "./budget.js";

const capabilities = {
  cost_budget: true,
  runtime_budget: true,
  token_budget: false,
} as Capabilities;

const provider = { capabilities } as Provider;

function task(patch: Partial<Task> = {}) {
  return {
    turn: 2,
    runtime_ms: 0,
    budget: { max_runtime_minutes: 10, max_cost_usd: 1 },
    ...patch,
  } as Task;
}

test("a budget can only be raised or lifted", () => {
  const t = task();

  raiseBudget(t, { max_runtime_minutes: 20, max_cost_usd: null });
  assert.deepEqual(t.budget, { max_runtime_minutes: 20, max_cost_usd: null });

  assert.throws(
    () => raiseBudget(t, { max_runtime_minutes: 5 }),
    /max_runtime_minutes is 20/,
  );

  assert.throws(
    () => raiseBudget(t, { max_cost_usd: 2 }),
    /max_cost_usd is unlimited/,
  );
});

test("an applied raise keeps limits raised earlier in the same turn", () => {
  const t = task({ budget_raised_for_turn: { turn: 2, runtime: true } });
  const { budget, raised } = raisedBudget(t, { max_cost_usd: 3 }, provider);

  assert.deepEqual(budget, { max_runtime_minutes: 10, max_cost_usd: 3 });
  assert.deepEqual(raised, { turn: 2, cost: true, runtime: true });
  // The task keeps its budget until the caller saves the new one.
  assert.equal(t.budget.max_cost_usd, 1);

  // A raise from an earlier turn no longer counts.
  const later = raisedBudget(
    task({ budget_raised_for_turn: { turn: 1, runtime: true } }),
    { max_cost_usd: 3 },
    provider,
  );

  assert.deepEqual(later.raised, { turn: 2, cost: true });

  assert.throws(
    () => raisedBudget(t, { max_cost_usd: 1 }, provider),
    /Choose a changed budget limit/,
  );
});

test("a raise the provider can't enforce is rejected", () => {
  assert.throws(
    () =>
      raisedBudget(
        task({ budget: { max_runtime_minutes: 10, max_cost_usd: null } }),
        { max_runtime_minutes: 20 },
        {
          capabilities: { ...capabilities, runtime_budget: false },
        } as Provider,
      ),
    /does not support runtime budgets/,
  );
});

test("remaining runtime stops a turn once either budget is used up", () => {
  assert.equal(remainingRuntime(task({ runtime_ms: 60000 })), 9 * 60000);

  assert.equal(
    remainingRuntime(
      task({ budget: { max_runtime_minutes: null, max_cost_usd: null } }),
    ),
    Infinity,
  );

  assert.throws(() => remainingRuntime(task({ runtime_ms: 10 * 60000 })), {
    name: "RunError",
    code: "runtime_budget_exhausted",
  });

  assert.throws(() => remainingRuntime(task({ cost_usd: 1 })), {
    name: "RunError",
    code: "cost_budget_exhausted",
  });
});

import {
  type BudgetRaise,
  budgetRaiseSchema,
  type Start,
  type Task,
} from "../../../../shared/tasks/model.js";
import { RunError } from "../../providers/run-error.js";
import type { Provider } from "../../providers/types.js";

type Budget = Start["budget"];

/** Rejects a budget the task's provider can't enforce. */
export function validateBudgets(
  provider: Provider | undefined,
  task: { budget: Budget },
) {
  if (!provider) throw new Error("Provider is not enabled");

  if (task.budget.max_cost_usd !== null && !provider.capabilities.cost_budget) {
    throw new Error(
      "Provider does not support cost budgets; explicitly set max_cost_usd to null to run without a cost limit",
    );
  }

  if (task.budget.max_tokens && !provider.capabilities.token_budget) {
    throw new Error("Provider does not support token budgets");
  }

  if (!provider.capabilities.runtime_budget) {
    throw new Error("Provider does not support runtime budgets");
  }
}

/**
 * Raises a task's budget. Each limit can only go up: to a higher amount, or
 * to null for no limit.
 */
export function raiseBudget(task: { budget: Budget }, raise: BudgetRaise) {
  const budget = budgetRaiseSchema.parse(raise);

  for (const key of ["max_runtime_minutes", "max_cost_usd"] as const) {
    const next = budget[key];
    const current = task.budget[key];

    if (next === undefined) continue;

    if (next !== null && (current === null || next < current)) {
      throw new Error(
        `The budget can only be raised: ${key} is ${current ?? "unlimited"}`,
      );
    }

    task.budget[key] = next;
  }
}

/**
 * An idle task's budget after `raise`, and the limits raised for its current
 * turn. A limit raised earlier in the turn stays recorded, so a failure at
 * both limits shows until each one is changed.
 */
export function raisedBudget(
  task: Task,
  raise: BudgetRaise,
  provider: Provider | undefined,
) {
  const original = task.budget;
  const budget = { ...original };
  raiseBudget({ budget }, raise);

  if (
    budget.max_runtime_minutes === original.max_runtime_minutes &&
    budget.max_cost_usd === original.max_cost_usd
  ) {
    throw new Error("Choose a changed budget limit to apply.");
  }

  validateBudgets(provider, { budget });

  const raisedFrom = (key: "max_runtime_minutes" | "max_cost_usd") => {
    const next = budget[key];
    const current = original[key];

    return next !== null && current !== null && next > current;
  };

  const previous =
    task.budget_raised_for_turn?.turn === task.turn
      ? task.budget_raised_for_turn
      : undefined;

  return {
    budget,
    raised: {
      turn: task.turn,
      ...(previous?.cost || raisedFrom("max_cost_usd") ? { cost: true } : {}),
      ...(previous?.runtime || raisedFrom("max_runtime_minutes")
        ? { runtime: true }
        : {}),
    } satisfies NonNullable<Task["budget_raised_for_turn"]>,
  };
}

/**
 * How long the task's next turn may run, in milliseconds. Throws when the
 * runtime or cost budget is already used up.
 */
export function remainingRuntime(task: Task) {
  const remaining =
    task.budget.max_runtime_minutes === null
      ? Infinity
      : task.budget.max_runtime_minutes * 60000 - task.runtime_ms;

  if (remaining <= 0) {
    throw new RunError("runtime_budget_exhausted");
  }

  if (
    task.budget.max_cost_usd !== null &&
    (task.cost_usd ?? 0) >= task.budget.max_cost_usd
  ) {
    throw new RunError("cost_budget_exhausted");
  }

  return remaining;
}

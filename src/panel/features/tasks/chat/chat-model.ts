import type { BudgetRaise } from "../../../../shared/tasks/model";
import type { Task } from "../../../app/state/types";

/** Statuses in which a turn is running, starting or about to. */
const BUSY = ["queued", "starting", "running", "waiting"];

/**
 * What the composer can do for a task: start its next turn, steer or
 * queue into a running one, or only queue while the worker waits for input.
 */
export type ComposerMode = "idle" | "busy" | "input";

export function composerMode(task: Task): ComposerMode {
  if (task.pending_input) return "input";

  return BUSY.includes(task.status) ? "busy" : "idle";
}

/** A budget the task has used up, with the amounts used and allowed. */
export type SpentBudget = {
  cost?: { used: number; allowed: number };
  runtime?: { usedMinutes: number; allowedMinutes: number };
};

/**
 * The limits an idle task has reached, so the next message can raise them;
 * undefined while it has room. Claude stops at its own cost estimate, so a
 * budget failure counts even a little under the limit.
 */
export function spentBudget(task: Task): SpentBudget | undefined {
  if (composerMode(task) !== "idle") return undefined;
  const { max_cost_usd, max_runtime_minutes } = task.budget;

  const cost = task.cost_usd ?? 0,
    minutes = task.runtime_ms / 60000,
    failed = task.status === "failed" && /budget/i.test(task.error ?? "");

  const spent: SpentBudget = {
    ...(max_cost_usd !== null &&
    (cost >= max_cost_usd || (failed && /cost|usd/i.test(task.error ?? "")))
      ? { cost: { used: cost, allowed: max_cost_usd } }
      : {}),
    ...(max_runtime_minutes !== null &&
    (minutes >= max_runtime_minutes ||
      (failed && /runtime/i.test(task.error ?? "")))
      ? {
          runtime: {
            usedMinutes: minutes,
            allowedMinutes: max_runtime_minutes,
          },
        }
      : {}),
  };

  return spent.cost || spent.runtime ? spent : undefined;
}

/** A raise that doubles each spent limit, within the allowed maximums. */
export function suggestedRaise(spent: SpentBudget) {
  return {
    ...(spent.cost
      ? { max_cost_usd: Math.min(spent.cost.allowed * 2, 100) }
      : {}),
    ...(spent.runtime
      ? {
          max_runtime_minutes: Math.min(spent.runtime.allowedMinutes * 2, 120),
        }
      : {}),
  };
}

/** Every exhausted limit must be raised or explicitly removed to continue. */
export function budgetRaised(spent: SpentBudget, raise: BudgetRaise) {
  const raised = (next: number | null | undefined, current: number) =>
    next === null || (typeof next === "number" && next > current);

  return (
    (!spent.cost || raised(raise.max_cost_usd, spent.cost.allowed)) &&
    (!spent.runtime ||
      raised(raise.max_runtime_minutes, spent.runtime.allowedMinutes))
  );
}

export const formatCost = (usd: number) =>
  `$${usd < 0.01 && usd > 0 ? usd.toFixed(3) : usd.toFixed(2)}`;

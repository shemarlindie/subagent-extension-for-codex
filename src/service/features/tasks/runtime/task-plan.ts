import type { Task } from "../../../../shared/tasks/model.js";
import type { PlanStep } from "../../../../shared/tasks/plan-contract.js";
import {
  pinnedPlan,
  planOpen,
  type TaskPlan,
} from "../../../../shared/tasks/plan.js";
import type { Store } from "../storage/store.js";

const sameSteps = (a: PlanStep[], b: PlanStep[]) =>
  a.length === b.length && a.every((s, i) => s.content === b[i]?.content);

/**
 * Saves the worker's plan on the task and records each update with it. An
 * empty list clears the plan. A pinned plan that the update finishes,
 * replaces or clears also records `task.plan_ended`, which Chat keeps as
 * history.
 */
export const planRecorder =
  (store: Store, t: Task) => (steps: PlanStep[], changed?: number[]) => {
    const before = t.plan;
    const pinned = pinnedPlan(before);

    // A finished plan ends once, unless it's sent again as a different list.
    const finishes =
      steps.length > 0 &&
      !planOpen(steps) &&
      (!before || planOpen(before.steps) || !sameSteps(before.steps, steps));

    if (steps.length) {
      t.plan = { steps };
    } else {
      delete t.plan;
    }

    store.transaction(() => {
      store.save(t);

      if (pinned && !sameSteps(pinned.steps, steps)) {
        store.event(t, "task.plan_ended", { steps: pinned.steps });
      }

      store.event(t, "agent.plan", { steps, ...(changed ? { changed } : {}) });

      if (finishes) store.event(t, "task.plan_ended", { steps });
    });
  };

/**
 * Ends the plan with its turn. One with steps left records `task.plan_ended`,
 * as a finished plan already did. Call in the transaction that saves the task.
 */
export function endPlan(store: Store, t: Task) {
  const pinned = pinnedPlan(t.plan);
  if (pinned) store.event(t, "task.plan_ended", { steps: pinned.steps });
  delete t.plan;
}

/** Marks a plan with steps left as made before a steer the worker took. */
export function markPlanStale(plan: TaskPlan | undefined) {
  if (plan && planOpen(plan.steps)) plan.stale = true;
}

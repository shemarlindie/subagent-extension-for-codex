import type { Task } from "../../../../shared/tasks/model.js";
import type { PlanStep } from "../../../../shared/tasks/plan-contract.js";
import {
  pinnedPlan,
  planOpen,
  type TaskPlan,
} from "../../../../shared/tasks/plan.js";
import { now } from "../../../../shared/time.js";
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
      t.plan = { steps, turn: t.turn, updated_at: now() };
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
 * At a turn's end, sets aside a plan the worker left stale through the turn,
 * so it leaves the pinned card. Call inside the turn's transaction.
 */
export function setPlanAside(store: Store, t: Task) {
  const pinned = pinnedPlan(t.plan);
  if (!pinned?.stale) return;
  pinned.set_aside = true;
  store.event(t, "task.plan_ended", { steps: pinned.steps });
}

/**
 * Marks a plan with steps left as made before the worker's latest message,
 * for a taken steer or a new turn.
 */
export function markPlanStale(plan: TaskPlan | undefined) {
  if (plan && planOpen(plan.steps)) plan.stale = true;
}

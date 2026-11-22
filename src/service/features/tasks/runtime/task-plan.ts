import type { Task } from "../../../../shared/tasks/model.js";
import type { PlanStep } from "../../../../shared/tasks/plan-contract.js";
import { now } from "../../../../shared/time.js";
import type { Store } from "../storage/store.js";

/**
 * Saves the worker's plan on the task and records each update with it. An
 * empty list clears the plan.
 */
export const planRecorder =
  (store: Store, t: Task) => (steps: PlanStep[], changed?: number[]) => {
    if (steps.length) {
      t.plan = { steps, turn: t.turn, updated_at: now() };
    } else {
      delete t.plan;
    }

    store.transaction(() => {
      store.save(t);
      store.event(t, "agent.plan", { steps, ...(changed ? { changed } : {}) });
    });
  };

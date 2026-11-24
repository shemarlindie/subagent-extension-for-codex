import { planWrappedUp } from "../../../../shared/tasks/plan.js";
import { wrapUpError } from "../../../../shared/tasks/wrap-up.js";
import type { RunContext } from "../../providers/types.js";
import type { Active } from "./turn-outcome.js";

/**
 * Holds the worker's wrap-up on the turn for its reply and checks off the
 * plan. Throws for one that breaks the field rules.
 */
export const wrapUpRecorder =
  (
    a: Active,
    planUpdated: RunContext["planUpdated"],
  ): RunContext["wrappedUp"] =>
  (wrapUp) => {
    const problem = wrapUpError(wrapUp);
    if (problem) throw new Error(problem);
    a.wrapUp = wrapUp;
    const update = planWrappedUp(a.task.plan?.steps);
    if (update) planUpdated(update.steps, update.changed);
  };

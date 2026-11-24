import { planWrappedUp } from "../../../../shared/tasks/plan.js";
import type { WrapUp } from "../../../../shared/tasks/wrap-up-contract.js";
import { wrapUpError } from "../../../../shared/tasks/wrap-up.js";
import type { RunContext } from "../../providers/types.js";
import type { Store } from "../storage/store.js";
import type { Active } from "./turn-outcome.js";

/**
 * Holds the worker's wrap-up on the turn for its reply and checks off the
 * plan. Throws for one that breaks the field rules.
 */
export const wrapUpRecorder =
  (
    store: Store,
    a: Active,
    planUpdated: RunContext["planUpdated"],
  ): RunContext["wrappedUp"] =>
  (wrapUp) => {
    const problem = wrapUpError(wrapUp);
    if (problem) throw new Error(problem);
    a.wrapUp = sentByCodex(store, a) ? withoutAskCodex(wrapUp) : wrapUp;
    const update = planWrappedUp(a.task.plan?.steps);
    if (update) planUpdated(update.steps, update.changed);
  };

/** Whether Codex sent the latest message the worker has, or the request before any. */
function sentByCodex(store: Store, { task }: Active) {
  const sent = task.instructions_sent;
  const [latest] = store.messages.list(task.id, Math.max(0, sent - 1), sent);

  return (latest?.from ?? task.created_by) === "parent";
}

/** Ask Codex would hand Codex its own work. */
function withoutAskCodex({ actions, ...wrapUp }: WrapUp): WrapUp {
  const kept = actions?.filter(
    (action) => !("action" in action && action.action === "ask_codex"),
  );

  return kept?.length ? { ...wrapUp, actions: kept } : wrapUp;
}

import type { Task } from "./model.js";
import type { WrapUp } from "./wrap-up-contract.js";

export const MAX_RECAP = 300;
export const MAX_ASK = 100;
export const MAX_ACTION_LABEL = 24;

/** Why a wrap-up breaks the field rules, or undefined when it doesn't. */
export function wrapUpError({ recap, ask, actions, blocked }: WrapUp) {
  if (!recap.trim() || recap.length > MAX_RECAP) {
    return `The recap needs 1 to ${MAX_RECAP} characters.`;
  }

  if (ask === undefined) {
    return actions || blocked ? "actions and blocked need an ask." : undefined;
  }

  if (!ask.trim() || ask.length > MAX_ASK) {
    return `The ask needs 1 to ${MAX_ASK} characters.`;
  }

  if (!actions?.length || actions.length > 2) {
    return "An ask needs 1 or 2 actions.";
  }

  return actions.some(
    (a) =>
      "label" in a && (!a.label.trim() || a.label.length > MAX_ACTION_LABEL),
  )
    ? `Each label needs 1 to ${MAX_ACTION_LABEL} characters.`
    : undefined;
}

/**
 * The task's latest reply ended blocked on the user, who hasn't sent the next
 * message yet. Sending one starts a new turn, which clears it.
 */
export const blockedOnUser = (
  task: Pick<Task, "status" | "turn">,
  reply?: { turn: number; blocked?: true },
) =>
  Boolean(reply?.blocked) &&
  reply?.turn === task.turn &&
  task.status === "completed";

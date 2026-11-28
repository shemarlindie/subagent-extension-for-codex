import type { Task } from "../../../../core/shared/tasks/model.js";
import type { WrapUp } from "../../../../core/shared/tasks/wrap-up-contract.js";
import { now } from "../../../../core/shared/time.js";
import type { Steer } from "../../providers/types.js";
import type { PendingInput } from "../input/pending-input.js";
import type { Store } from "../storage/store.js";
import { commitQueue, leaveOver, queueSnapshot } from "./queue.js";
import { endPlan } from "./task-plan.js";

/**
 * Ends a turn the service lost when it restarted. Steers still inside the
 * provider were lost with it, so they wait at the front of the queue, which
 * pauses as after any interrupt.
 */
export function interruptLostTurn(store: Store, t: Task) {
  t.status = "interrupted";
  delete t.pending_input;
  delete t.waiting_reason;
  t.error = "Service restarted; send a message to continue.";
  delete t.error_code;
  t.completed_at = now();
  const queue = queueSnapshot(t);
  leaveOver(t);
  if (t.queue.length) t.queue_paused = true;

  commitQueue(store, t, queue, () => {
    endPlan(store, t);
    store.event(t, "task.interrupted", { reason: "service_restart" });
  });
}

/** The payload of a task's status event once its turn has ended. */
export function recordStatusEvent(store: Store, t: Task) {
  if (t.status === "queued") return store.event(t, "task.queued");

  if (t.status === "completed") {
    return store.event(t, "task.completed");
  }

  if (t.status === "failed") {
    return store.event(t, "task.failed", {
      ...(t.error ? { error: t.error } : {}),
      ...(t.error_code ? { error_code: t.error_code } : {}),
    });
  }

  if (t.status === "interrupted") {
    return store.event(t, "task.interrupted", {
      ...(t.error ? { error: t.error } : {}),
    });
  }

  throw new Error(`Cannot record a turn outcome for task status ${t.status}`);
}

export interface Active {
  /** The task as the turn holds it; changes while it runs go here. */
  task: Task;
  input: PendingInput;
  stopStatus?: "interrupted";
  /** Interrupt and send now: the pending steers start the next turn. */
  sendPending?: boolean;
  /** Where the provider takes steers, once it registers. */
  sink?: (steer: Steer) => boolean;
  /** The worker's wrap-up, for the turn's reply. */
  wrapUp?: WrapUp;
  abort: AbortController;
  done: Promise<void>;
}

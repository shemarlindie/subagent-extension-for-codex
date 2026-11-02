import type { Task } from "../../../../shared/tasks/model.js";
import type { Steer } from "../../providers/types.js";
import type { PendingInput } from "../input/pending-input.js";
import type { Store } from "../storage/store.js";

/** The payload of a task's status event once its turn has ended. */
export function recordStatusEvent(store: Store, t: Task) {
  if (t.status === "queued") return store.event(t, "task.queued");

  if (t.status === "completed") {
    return store.event(t, "task.completed");
  }

  if (t.status === "failed") {
    return store.event(t, "task.failed", {
      ...(t.error ? { error: t.error } : {}),
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
  /** Completion report held until a successful turn is recorded. */
  parentMessage?: string;
  abort: AbortController;
  done: Promise<void>;
}

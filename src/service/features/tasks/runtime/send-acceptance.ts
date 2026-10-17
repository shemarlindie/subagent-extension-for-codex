import type { Task } from "../../../../shared/tasks/model.js";
import type { Store } from "../storage/store.js";
import { measureTaskWrite } from "./timing.js";

/** Rolls back the active turn's object as well as durable send acceptance. */
export function commitSend(store: Store, task: Task, write: () => void) {
  // Sends append messages and change lifecycle fields. Provider state and the
  // rest of the task remain owned by the running turn.
  const before = {
    queue: [...task.queue],
    instructions: [...task.instructions],
    pending_steers: [...task.pending_steers],
    budget: { ...task.budget },
    status: task.status,
    queue_paused: task.queue_paused,
    error: task.error,
    completed_at: task.completed_at,
    updated_at: task.updated_at,
  };

  measureTaskWrite(task.id, () => {
    try {
      store.transaction(write);
    } catch (error) {
      Object.assign(task, before);
      throw error;
    }
  });
}

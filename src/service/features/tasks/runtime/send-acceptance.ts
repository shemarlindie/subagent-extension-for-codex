import type { Task } from "../../../../shared/tasks/model.js";
import type { Store } from "../storage/store.js";
import { measureTaskWrite, sendRef } from "./timing.js";

/**
 * Rolls back the active turn's object as well as durable send acceptance.
 * `requestId` correlates the send's timing without being recorded.
 */
export function commitSend(
  store: Store,
  task: Task,
  write: () => void,
  requestId?: string,
) {
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
    error_code: task.error_code,
    completed_at: task.completed_at,
    updated_at: task.updated_at,
  };

  measureTaskWrite({ task_id: task.id, send_ref: sendRef(requestId) }, () => {
    try {
      store.transaction(write);
    } catch (error) {
      Object.assign(task, before);
      throw error;
    }
  });
}

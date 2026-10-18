import type { Task } from "./model.js";

/** The tasks an archive or unarchive changed, and those it skipped. */
export type ArchiveResult = { task_ids: string[]; skipped: string[] };

/**
 * Whether the user can archive a task: it has stopped, with no request
 * waiting for an answer and no queued message waiting for a turn. Archiving
 * hides a task from the panel's lists, so work that could still need the
 * user stays listed.
 */
export const archivable = (
  task: Pick<Task, "status" | "pending_input" | "queue">,
) =>
  ["completed", "failed", "interrupted"].includes(task.status) &&
  !task.pending_input &&
  !task.queue.length;

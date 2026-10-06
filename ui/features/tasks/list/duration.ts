import type { Task } from "../../../shared/state/types";

/** Compact elapsed time: `45s`, `3m 05s`, `1h 02m`. */
export function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000)),
    hours = Math.floor(total / 3600),
    minutes = Math.floor((total % 3600) / 60),
    seconds = total % 60;

  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;

  return `${seconds}s`;
}

/** Whether the runtime is still accumulating for a run in progress. */
export const runtimeLive = (task: Task) =>
  task.status === "running" && Boolean(task.run_started_at);

/** Finished runs plus the one in progress, which `runtime_ms` does not yet include. */
export function taskRuntimeMs(task: Task, now: number) {
  // An input request holds the current run open. Freeze its display when the
  // request arrived; resuming reconciles with the backend's runtime budget.
  const waiting = task.status === "waiting" && Boolean(task.pending_input);
  if (!task.run_started_at || (!runtimeLive(task) && !waiting))
    return task.runtime_ms;
  const end = waiting ? Date.parse(task.updated_at) : now;
  if (!Number.isFinite(end)) return task.runtime_ms;

  return (
    task.runtime_ms + Math.max(0, end - new Date(task.run_started_at).getTime())
  );
}

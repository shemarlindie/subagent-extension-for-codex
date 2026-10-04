import type { Task } from "./types";

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
  if (!runtimeLive(task)) return task.runtime_ms;
  return (
    task.runtime_ms +
    Math.max(0, now - new Date(task.run_started_at!).getTime())
  );
}

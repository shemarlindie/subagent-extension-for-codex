import { locked, statusLabel } from "./selectors";
import type { Task } from "./types";

export function rowStatus(task: Task) {
  const activity = task.status === "running" ? task.live_activity : undefined,
    kind = locked(task)
      ? "unconfirmed"
      : task.pending_input
        ? "input"
        : activity?.state === "failed"
          ? "failed"
          : activity?.text.startsWith("Needs input")
            ? "input"
            : activity?.text === "Waiting for rate limit reset"
              ? "paused"
              : task.status,
    label =
      activity &&
      (kind === "failed" || kind === "paused" || kind === "input") &&
      !task.pending_input
        ? activity.text
        : statusLabel(task);
  const shortLabels = {
    queued: "Queued",
    starting: "Starting",
    running: "Running",
    waiting: "Waiting",
    interrupted: "Interrupted",
    completed: "Done",
    failed: "Failed",
    cancelled: "Stopped",
    input: "Needs input",
    paused: "Rate limit",
    unconfirmed: "Unconfirmed",
  };
  const displayLabel =
    activity?.text === "Context compaction failed"
      ? "Compaction failed"
      : label;
  return {
    kind,
    label: displayLabel,
    shortLabel:
      activity?.text === "Context compaction failed"
        ? "Compaction failed"
        : shortLabels[kind],
  };
}

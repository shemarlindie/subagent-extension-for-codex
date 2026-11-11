import { statusLabel } from "../../../app/state/selectors";
import type { Task } from "../../../app/state/types";

type RowKind = Task["status"] | "input" | "paused";

// Live activity can mark a running task as failed, paused, or waiting for input.
function rowKind(task: Task, activity: Task["live_activity"]): RowKind {
  if (task.pending_input) return "input";
  if (activity?.state === "failed") return "failed";
  if (activity?.text.startsWith("Needs input")) return "input";
  if (activity?.text === "Waiting for rate limit reset") return "paused";

  return task.status;
}

export function rowStatus(task: Task) {
  const activity = task.status === "running" ? task.live_activity : undefined;
  const kind = rowKind(task, activity);

  const label =
    activity &&
    (kind === "failed" || kind === "paused" || kind === "input") &&
    !task.pending_input
      ? activity.text
      : statusLabel(task);

  const shortLabels: Record<RowKind, string> = {
    queued: "Queued",
    starting: "Starting",
    running: "Running",
    waiting: "Waiting",
    interrupted: "Interrupted",
    completed: "Done",
    failed: "Failed",
    input: "Needs input",
    paused: "Rate limit",
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

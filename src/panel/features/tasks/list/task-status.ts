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

/**
 * A working task's dot pulses gray, and a queued one stays gray. One that
 * needs input or is paused by a rate limit needs attention and shows yellow.
 * Rows leave out the dot for quiet statuses, and the label carries the exact
 * status.
 */
export type StatusTone = "working" | "queued" | "attention" | "quiet";

const STATUS_TONES: Record<RowKind, StatusTone> = {
  starting: "working",
  running: "working",
  queued: "queued",
  paused: "attention",
  input: "attention",
  failed: "quiet",
  waiting: "quiet",
  interrupted: "quiet",
  completed: "quiet",
};

export const statusTone = (kind: RowKind) => STATUS_TONES[kind];

export function rowStatus(task: Task) {
  const activity = task.status === "running" ? task.live_activity : undefined;
  const kind = rowKind(task, activity);

  const label =
    activity &&
    (kind === "failed" || kind === "paused" || kind === "input") &&
    !task.pending_input
      ? activity.text
      : statusLabel(task);

  return {
    kind,
    label:
      activity?.text === "Context compaction failed"
        ? "Compaction failed"
        : label,
  };
}

import type { rowStatus } from "./task-status";

type StatusPresentation = ReturnType<typeof rowStatus>;

type StatusKind = StatusPresentation["kind"];

/**
 * A working task's dot pulses gray, and one that needs input shows yellow.
 * Rows leave out the dot for quiet statuses, and the label carries the exact
 * status.
 */
type StatusTone = "working" | "input" | "quiet";

const STATUS_TONES: Record<StatusKind, StatusTone> = {
  starting: "working",
  running: "working",
  paused: "working",
  input: "input",
  failed: "quiet",
  queued: "quiet",
  waiting: "quiet",
  interrupted: "quiet",
  completed: "quiet",
};

export const statusTone = (kind: StatusKind) => STATUS_TONES[kind];

interface TaskStatusIconProps extends Pick<
  StatusPresentation,
  "kind" | "label"
> {
  decorative?: boolean;
}

export function TaskStatusIcon({
  kind,
  label,
  decorative = false,
}: TaskStatusIconProps) {
  return (
    <span
      className={`row-status-icon dot ${kind}`}
      data-tone={statusTone(kind)}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      title={decorative ? undefined : label}
    />
  );
}

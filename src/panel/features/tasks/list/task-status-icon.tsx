import type { rowStatus } from "./task-status";

type StatusPresentation = ReturnType<typeof rowStatus>;

type StatusKind = StatusPresentation["kind"];

/**
 * A status shows as a dot in one of four tones: green and glowing while the
 * task works, amber when it needs input, red when it failed, and gray once
 * it stops or waits its turn. The label carries the exact status.
 */
type StatusTone = "working" | "input" | "failed" | "quiet";

const STATUS_TONES: Record<StatusKind, StatusTone> = {
  starting: "working",
  running: "working",
  paused: "working",
  input: "input",
  failed: "failed",
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

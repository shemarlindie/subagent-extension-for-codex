import type { ReactNode } from "react";

import type { rowStatus } from "./task-status";

type StatusPresentation = ReturnType<typeof rowStatus>;

type StatusKind = StatusPresentation["kind"];

/**
 * Statuses share six marks, each told apart by shape as well as color: an arc
 * that turns while work runs, a dashed ring while it waits, a ring with a dot
 * when it needs input, a square when interrupted, an exclamation when it
 * failed and a check when done.
 */
type StatusMark =
  "working" | "pending" | "input" | "stopped" | "failed" | "done";

const STATUS_MARKS: Record<StatusKind, StatusMark> = {
  starting: "working",
  running: "working",
  queued: "pending",
  waiting: "pending",
  paused: "pending",
  input: "input",
  interrupted: "stopped",
  failed: "failed",
  completed: "done",
};

// Drawn on a 16px grid around a ring of radius 6.
const MARK_ARTWORK: Record<StatusMark, ReactNode> = {
  working: (
    <>
      <circle cx="8" cy="8" r="6" opacity="0.25" />
      <path d="M8 2a6 6 0 0 1 5.2 9" />
    </>
  ),
  pending: <circle cx="8" cy="8" r="6" strokeDasharray="2.36 2.36" />,
  input: (
    <>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  stopped: (
    <rect
      x="4"
      y="4"
      width="8"
      height="8"
      rx="1.75"
      fill="currentColor"
      stroke="none"
    />
  ),
  failed: (
    <>
      <circle cx="8" cy="8" r="6.75" fill="currentColor" stroke="none" />
      <path d="M8 4.75v3.75" className="row-status-knockout" />
      <circle
        cx="8"
        cy="11.1"
        r="0.95"
        className="row-status-knockout"
        stroke="none"
      />
    </>
  ),
  done: <path d="M3.5 8.5 6.5 11.5 12.5 4.75" />,
};

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
  const mark = STATUS_MARKS[kind];
  const named = !decorative;

  return (
    <svg
      viewBox="0 0 16 16"
      width={12}
      height={12}
      className={`row-status-icon ${kind}`}
      data-mark={mark}
      role={named ? "img" : undefined}
      aria-label={named ? label : undefined}
      aria-hidden={named ? undefined : true}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {named && <title>{label}</title>}
      {MARK_ARTWORK[mark]}
    </svg>
  );
}

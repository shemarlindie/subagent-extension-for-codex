import { memo } from "react";

import { statusTone, type rowStatus } from "./task-status";

type StatusPresentation = ReturnType<typeof rowStatus>;

interface TaskStatusIconProps extends Pick<
  StatusPresentation,
  "kind" | "label"
> {
  decorative?: boolean;
}

/** Memoized, so Chat's status line stays still while a reply streams. */
export const TaskStatusIcon = memo(function TaskStatusIcon({
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
});

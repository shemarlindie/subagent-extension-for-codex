import { statusTone, type rowStatus } from "./task-status";

type StatusPresentation = ReturnType<typeof rowStatus>;

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

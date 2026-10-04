import type { rowStatus } from "../core/task-status";

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
  const path =
    kind === "running" || kind === "starting"
      ? "M7 4l12 8-12 8Z"
      : kind === "paused" || kind === "waiting"
        ? "M8 5v14M16 5v14"
        : kind === "completed"
          ? "M5 12l4 4L19 6"
          : kind === "failed" || kind === "interrupted"
            ? "M6 6l12 12M18 6L6 18"
            : kind === "input"
              ? "M4 20h16M5 15l-1 4 4-1L19 7l-3-3Z M13 7l3 3"
              : kind === "cancelled"
                ? "M6 6h12v12H6Z"
                : "M12 8v4l3 2";
  return (
    <svg
      className={`row-status-icon ${kind}`}
      viewBox="0 0 24 24"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {!decorative && <title>{label}</title>}
      {kind === "running" && (
        <>
          <circle className="row-status-glow" cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
        </>
      )}
      {kind === "queued" && <circle cx="12" cy="12" r="9" />}
      {kind !== "running" && <path d={path} />}
    </svg>
  );
}

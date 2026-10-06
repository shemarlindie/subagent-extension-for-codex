import { Icon, type IconName } from "../../../shared/components/icons";
import type { rowStatus } from "./task-status";

type StatusPresentation = ReturnType<typeof rowStatus>;

const STATUS_ICONS: Record<StatusPresentation["kind"], IconName> = {
  running: "dot",
  starting: "play",
  paused: "pause",
  waiting: "pause",
  completed: "check",
  failed: "close",
  interrupted: "close",
  unconfirmed: "help",
  input: "pencil",
  cancelled: "stop",
  queued: "clock",
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
  return (
    <Icon
      name={STATUS_ICONS[kind]}
      size={10}
      className={`row-status-icon ${kind}`}
      label={decorative ? undefined : label}
    />
  );
}

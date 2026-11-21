import { currentActivityStatus } from "../../../../shared/tasks/activity/activity-status";
import { useSnapshot } from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { rowStatus } from "../list/task-status";
import { TaskStatusIcon } from "../list/task-status-icon";
import { composerMode } from "./chat-model";

type ChatWorkingStatusProps = { task?: Task };

export function ChatWorkingStatus({ task }: ChatWorkingStatusProps) {
  const { events } = useSnapshot(["events"]);

  let status: ReturnType<typeof rowStatus> | undefined;

  if (task && composerMode(task) === "busy") {
    const activity =
      task.status === "running" && events.length
        ? currentActivityStatus(events, task)
        : task.live_activity;

    status = rowStatus({ ...task, live_activity: activity });
    if (task.status === "running" && activity) status.label = activity.text;
  }

  return (
    <div className="chat-working" role="status" aria-atomic="true">
      {status && (
        <>
          <TaskStatusIcon kind={status.kind} label={status.label} decorative />
          <span title={status.label}>{status.label}</span>
        </>
      )}
    </div>
  );
}

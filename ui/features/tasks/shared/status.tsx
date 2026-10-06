import { MotionContent } from "../../../shared/components/motion";
import { statusLabel } from "../../../shared/state/selectors";
import type { Task } from "../../../shared/state/types";
import type { ActivityState } from "../activity/activity-timeline";
import { rowStatus } from "../list/task-status";
import { TaskStatusIcon } from "../list/task-status-icon";

interface TaskStatusProps {
  task: Task;
  activity?: { text: string; state: ActivityState };
}

export function TaskStatus({ task, activity }: TaskStatusProps) {
  const presentation = rowStatus(
    activity ? { ...task, live_activity: activity } : task,
  );

  return (
    <>
      <TaskStatusIcon
        kind={presentation.kind}
        label={presentation.label}
        decorative
      />
      <MotionContent changeKey={statusLabel(task)}>
        {statusLabel(task)}
      </MotionContent>
    </>
  );
}

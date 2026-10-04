import type { Task } from "../core/types";
import { rowStatus } from "../core/task-status";
import type { ActivityState } from "../core/activity-timeline";
import { MotionContent } from "./motion";
import { TaskStatusIcon } from "./task-status-icon";
import { statusLabel } from "../core/selectors";

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

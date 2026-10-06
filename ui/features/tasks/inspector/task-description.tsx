import { ExpandableNotice } from "../../../shared/components/notice";
import type { Task } from "../../../shared/state/types";

interface TaskDescriptionProps {
  task: Task;
  defaultOpen?: boolean;
}

export function TaskDescription({
  task,
  defaultOpen = false,
}: TaskDescriptionProps) {
  return (
    <ExpandableNotice defaultOpen={defaultOpen}>
      {task.description}
    </ExpandableNotice>
  );
}

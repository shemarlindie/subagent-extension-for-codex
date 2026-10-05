import type { Task } from "../core/types";
import { ExpandableNotice } from "./notice";

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

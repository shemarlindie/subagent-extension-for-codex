import { useController } from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { EditableText } from "../../../shared/components/editable-text/editable-text";

type TaskTitleProps = { task: Task };

export function TaskTitle({ task }: TaskTitleProps) {
  const controller = useController();

  return (
    <h1 className="task-title">
      <EditableText
        value={task.title}
        label="Task title"
        maxLength={200}
        onSave={(title) => controller.taskActions.rename(task, title)}
      />
    </h1>
  );
}

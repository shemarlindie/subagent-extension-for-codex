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
        onSave={async (title) => {
          await controller.tool("rename_user_agent_task", {
            task_id: task.id,
            title,
          });

          await controller.refresh();
        }}
      />
    </h1>
  );
}

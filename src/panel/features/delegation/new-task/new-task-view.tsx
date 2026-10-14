import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import type { NewTaskState } from "../../../app/state/types";
import { Icon } from "../../../shared/components/icons/icons";
import { BackButton } from "../../../shared/components/navigation/back-button";
import { NewTaskComposer } from "./new-task-composer";

type NewTaskViewProps = { newTask: NewTaskState };

/**
 * The inspector while composing a task: an empty conversation with the
 * composer where Chat's will be, so sending flows straight into the task.
 */
export function NewTaskView({ newTask }: NewTaskViewProps) {
  const controller = useController(),
    state = useSnapshot();

  return (
    <div className="task-view new-task-view">
      <div className="task-header">
        <div className="task-topline">
          <BackButton
            className="task-inspector-back"
            label="Tasks"
            onClick={() => controller.back()}
          />
          <div className="task-meta">
            <div className="eyebrow">New task</div>
          </div>
        </div>
        <h2 className="new-task-title">What should Claude work on?</h2>
      </div>
      <div className="new-task-empty">
        <Icon name="worker" size={28} className="empty-icon" />
        <p>
          Your first message starts the task
          {state.repository ? " in this project" : ""}. Replies stream into
          Chat.
        </p>
      </div>
      <div className="chat-footer new-task-footer">
        <NewTaskComposer newTask={newTask} />
      </div>
    </div>
  );
}

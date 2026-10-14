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
 * The inspector while composing: Chat's panel without the task header or
 * tabs. The composer sits where Chat's will, and the header and tabs ease in
 * once the task starts.
 */
export function NewTaskView({ newTask }: NewTaskViewProps) {
  const controller = useController(),
    state = useSnapshot();

  return (
    <div className="task-view new-task-view">
      {/* Narrow panels need a way back to the list; wide ones hide it. */}
      <div className="task-topline new-task-topline">
        <BackButton
          className="task-inspector-back"
          label="Tasks"
          onClick={() => controller.back()}
        />
      </div>
      <div className="evidence">
        <div className="chat-panel">
          <div className="chat">
            <div className="chat-timeline new-task-empty">
              <Icon name="worker" size={28} className="empty-icon" />
              <p className="new-task-prompt">What should Claude work on?</p>
              <p>
                Your first message starts the task
                {state.repository ? " in this project" : ""}. Replies stream
                here.
              </p>
            </div>
            <div className="chat-footer">
              <NewTaskComposer newTask={newTask} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import type { Ref } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { useSessionState } from "../../../app/state/session/use-session-state";
import type { NewTaskState } from "../../../app/state/types";
import { BackButton } from "../../../shared/components/navigation/back-button";
import { WorkerProfileIcon } from "../../tasks/list/worker-profile-icon";
import { workerChoice } from "../delegation";
import { NewTaskComposer } from "./new-task-composer";
import { NEW_TASK_SESSION_ID, newTaskInitialValues } from "./new-task-values";

type NewTaskViewProps = {
  newTask: NewTaskState;
  viewRef?: Ref<HTMLDivElement>;
};

/**
 * The inspector while composing: Chat's panel without the task header or
 * tabs. The composer sits where Chat's will, and the header and tabs ease in
 * once the task starts.
 */
export function NewTaskView({ newTask, viewRef }: NewTaskViewProps) {
  const controller = useController(),
    state = useSnapshot(),
    [savedWorker] = useSessionState(
      "newTask",
      NEW_TASK_SESSION_ID,
      (session) => session.draft.worker,
    ),
    worker = savedWorker ?? newTaskInitialValues(newTask, state).worker;

  return (
    <div ref={viewRef} className="task-view new-task-view">
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
              <WorkerProfileIcon
                profile={workerChoice(worker).profile ?? ""}
                size={28}
                className="empty-icon"
              />
              <p className="new-task-prompt">What should Claude work on?</p>
              <p>
                Your first message starts the task
                {state.repository ? " in this project" : ""}.
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

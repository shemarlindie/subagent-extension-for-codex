import { useSnapshot } from "../../../app/state/controller-context";
import { useSessionState } from "../../../app/state/session/use-session-state";
import { Icon } from "../../../shared/components/icons/icons";
import { draftTitle, newTaskSessionId } from "./new-task-values";

/** The task list's placeholder for the task being composed. */
export function NewTaskRow() {
  const conversation = useSnapshot((state) => state.conversation);

  const [title] = useSessionState(
    "newTask",
    newTaskSessionId(conversation),
    (session) => draftTitle(session.draft.description),
  );

  const focusComposer = () =>
    document.getElementById("new-task-message")?.focus();

  return (
    <button
      className="row row-new-task"
      data-task="new"
      aria-current={true}
      onClick={focusComposer}
    >
      <span className="row-title">{title || "New task"}</span>
      <span className="row-meta">
        <span className="row-worker">
          <Icon name="pencil-simple" size={10} className="row-worker-icon" />
          <span className="row-worker-label">
            {title ? "Draft" : "Not started"}
          </span>
        </span>
      </span>
    </button>
  );
}

import { useSnapshot } from "../../../app/state/controller-context";
import { useSessionState } from "../../../app/state/session/use-session-state";
import { Icon } from "../../../shared/components/icons/icons";
import { draftTitle, newTaskSessionId } from "./new-task-values";

type NewTaskRowProps = {
  /** Matches compact task rows: the icon before the title on one line. */
  compact?: boolean;
};

/** The task list's placeholder for the task being composed. */
export function NewTaskRow({ compact = false }: NewTaskRowProps) {
  const conversation = useSnapshot((state) => state.conversation);

  const [title] = useSessionState(
    "newTask",
    newTaskSessionId(conversation),
    (session) => draftTitle(session.draft.description),
  );

  const focusComposer = () =>
    document.getElementById("new-task-message")?.focus();

  const state = title ? "Draft" : "Not started";

  return (
    <button
      className="row row-new-task"
      data-task="new"
      data-compact={compact ? "" : undefined}
      aria-current={true}
      onClick={focusComposer}
    >
      <span className="row-title">{title || "New task"}</span>
      {compact ? (
        <span className="row-worker" title={state}>
          <Icon name="pencil-simple" size={14} className="row-worker-icon" />
          <span className="visually-hidden">{state}</span>
        </span>
      ) : (
        <span className="row-meta">
          <span className="row-worker">
            <Icon name="pencil-simple" size={10} className="row-worker-icon" />
            <span className="row-worker-label">{state}</span>
          </span>
        </span>
      )}
    </button>
  );
}

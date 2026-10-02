import type { Task } from "../core/types";
import { locked } from "../core/selectors";
import { useController, useSnapshot } from "./controller-context";
export function TaskNotices({ task }: { task: Task }) {
  const controller = useController(),
    state = useSnapshot();
  return (
    <>
      {locked(task) ? (
        <div className="callout attention">
          <strong>Worker shutdown needs investigation</strong>
          <p>
            Termination is unconfirmed. Controls are locked. Bring this task to
            Codex to inspect the worker before continuing.
          </p>
        </div>
      ) : (
        task.pending_input && (
          <div className="callout attention">
            <strong>
              {task.pending_input.tool === "AskUserQuestion"
                ? "Claude has a question"
                : "Permission needed"}
            </strong>
            <p>
              {String(
                task.pending_input.tool === "AskUserQuestion"
                  ? "Review the worker’s question and respond to this request."
                  : (task.pending_input.input.description ??
                      task.pending_input.tool),
              )}
            </p>
            <button
              id="respond"
              className="primary"
              disabled={state.busy}
              onClick={() => controller.open({ kind: "respond", task })}
            >
              Review request
            </button>
          </div>
        )
      )}
      {task.error && !locked(task) && (
        <div className="callout attention">{task.error}</div>
      )}
    </>
  );
}

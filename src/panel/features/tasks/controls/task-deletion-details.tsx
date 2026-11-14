import type { TaskDeletionPreview } from "../../../../shared/tasks/deletion-contract.js";
import { TaskDeletionSummary } from "./task-deletion-summary";
import { TaskDeletionTargetItem } from "./task-deletion-target";

type TaskDeletionDetailsProps = {
  preview?: TaskDeletionPreview;
  error?: string;
  checking: boolean;
  disabled: boolean;
  onRefresh: () => void;
};

/** Previews the resources removed or retained when deleting tasks. */
export function TaskDeletionDetails({
  preview,
  checking,
  error,
  disabled,
  onRefresh,
}: TaskDeletionDetailsProps) {
  return (
    <section className="task-deletion-details" aria-label="Removal details">
      <div className="task-deletion-heading">
        <strong>Removal details</strong>
        <span className="form-note" role="status">
          {checking ? "Checking…" : ""}
        </span>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <TaskDeletionSummary
        preview={preview}
        refreshDisabled={checking || disabled}
        onRefresh={onRefresh}
      />
      {preview && preview.tasks.length > 0 && (
        <ul
          className="task-deletion-targets"
          aria-label="Selected task resources"
          aria-busy={checking}
        >
          {preview.tasks.map((task) => (
            <TaskDeletionTargetItem
              key={task.id}
              task={task}
              defaultOpen={preview.tasks.length === 1}
            />
          ))}
        </ul>
      )}
      {preview?.project && preview.tasks.length === 0 && (
        <p>No task records or worktrees remain.</p>
      )}
    </section>
  );
}

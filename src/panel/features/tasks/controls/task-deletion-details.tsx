import type { TaskDeletionPreview } from "../../../../shared/tasks/deletion-contract.js";
import { TaskDeletionTargetItem } from "./task-deletion-target";

type TaskDeletionDetailsProps = {
  preview?: TaskDeletionPreview;
  checking: boolean;
  error?: string;
};

/** Shows the server's removal list, including the full scope of each folder. */
export function TaskDeletionDetails({
  preview,
  checking,
  error,
}: TaskDeletionDetailsProps) {
  return (
    <section className="task-deletion-details" aria-label="Removal details">
      <strong>Removal details</strong>
      <p className="form-note task-deletion-status" role="status">
        {checking
          ? "Checking the removal list…"
          : preview &&
            `${preview.tasks.length} ${preview.tasks.length === 1 ? "task" : "tasks"}`}
      </p>
      {preview?.project && (
        <p>
          The saved project registration will be removed:{" "}
          <code>{preview.project}</code>
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <ul
          className="task-deletion-targets"
          aria-label="Selected task resources"
          tabIndex={0}
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

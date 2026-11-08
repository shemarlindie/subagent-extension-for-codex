import type { TaskDeletionPreview } from "../../../../shared/tasks/deletion-contract.js";
import { Button } from "../../../shared/components/button/button";
import { TaskDeletionTargetItem } from "./task-deletion-target";

type TaskDeletionDetailsProps = {
  preview?: TaskDeletionPreview;
  checking: boolean;
  error?: string;
  onRefresh: () => void;
  disabled?: boolean;
};

/** Shows the server's removal list, including the full scope of each folder. */
export function TaskDeletionDetails({
  preview,
  checking,
  error,
  onRefresh,
  disabled = false,
}: TaskDeletionDetailsProps) {
  return (
    <section className="task-deletion-details" aria-label="Removal details">
      <strong>Removal details</strong>
      {preview?.project && (
        <p>
          The saved project registration will be removed:{" "}
          <code>{preview.project}</code>
        </p>
      )}
      {checking && (
        <p className="form-note" role="status">
          Checking the removal list…
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
        >
          {preview.tasks.map((task) => (
            <TaskDeletionTargetItem key={task.id} task={task} />
          ))}
        </ul>
      )}
      {preview?.project && preview.tasks.length === 0 && (
        <p>No task records or worktrees remain.</p>
      )}
      <Button
        type="button"
        variant="text"
        disabled={checking || disabled}
        onClick={onRefresh}
      >
        Refresh removal list
      </Button>
    </section>
  );
}

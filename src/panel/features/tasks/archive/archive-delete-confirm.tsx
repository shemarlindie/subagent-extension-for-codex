import { useState } from "react";

import { Button } from "../../../shared/components/button/button";
import { AgentTaskDeletionOption } from "../controls/agent-task-deletion-option";
import { TaskDeletionDetails } from "../controls/task-deletion-details";
import { TaskDeletionRefresh } from "../controls/task-deletion-refresh";
import { useTaskDeletionPreview } from "../controls/use-task-deletion-preview";

type ArchiveDeleteConfirmProps = {
  taskIds: string[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: (deleteAgentTasks: boolean, confirmation: string) => void;
};

/** Confirms deleting archived tasks, with a choice to delete their provider sessions too. */
export function ArchiveDeleteConfirm({
  taskIds,
  pending,
  onCancel,
  onConfirm,
}: ArchiveDeleteConfirmProps) {
  const [deleteAgentTasks, setDeleteAgentTasks] = useState(false);
  const count = taskIds.length;
  const deletion = useTaskDeletionPreview(taskIds, deleteAgentTasks);

  const what = count === 1 ? "this task" : `these ${count} tasks`;

  return (
    <div
      className="archive-delete-confirm"
      role="group"
      aria-label="Confirm deletion"
    >
      <p className="form-note">
        Delete {what} and the resources listed below? This can't be undone.
      </p>
      <AgentTaskDeletionOption
        id="archive-delete-agent"
        label="Also delete the agent tasks"
        checked={deleteAgentTasks}
        busy={pending}
        sessionDeletion={deletion.preview?.sessionDeletion}
        onCheckedChange={setDeleteAgentTasks}
      />
      <TaskDeletionDetails
        preview={deletion.preview}
        checking={deletion.checking}
        error={deletion.error}
      />
      <div className="archive-delete-actions">
        <div className="archive-delete-refresh">
          <TaskDeletionRefresh
            checking={deletion.checking}
            disabled={pending}
            onRefresh={deletion.reload}
          />
        </div>
        <Button disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          className="archive-delete-submit"
          disabled={pending || deletion.checking || !deletion.confirmation}
          onClick={() =>
            deletion.confirmation &&
            onConfirm(deleteAgentTasks, deletion.confirmation)
          }
        >
          {count === 1 ? "Delete task" : `Delete ${count} tasks`}
        </Button>
      </div>
    </div>
  );
}

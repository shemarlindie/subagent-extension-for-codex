import { Switch } from "@base-ui/react/switch";
import { useState } from "react";

import { Button } from "../../../shared/components/button/button";

type ArchiveDeleteConfirmProps = {
  count: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (deleteAgentTasks: boolean) => void;
};

/** Confirms deleting archived tasks, with a choice to delete their provider sessions too. */
export function ArchiveDeleteConfirm({
  count,
  pending,
  onCancel,
  onConfirm,
}: ArchiveDeleteConfirmProps) {
  const [deleteAgentTasks, setDeleteAgentTasks] = useState(false);

  const what =
    count === 1
      ? "this task with its conversation, activity, worktree and branch"
      : `these ${count} tasks with their conversations, activity, worktrees and branches`;

  return (
    <div
      className="archive-delete-confirm"
      role="group"
      aria-label="Confirm deletion"
    >
      <p className="form-note">
        Delete {what}, uncommitted changes included? This can't be undone.
      </p>
      <div className="delete-option">
        <div className="delete-option-text">
          <span id="archive-delete-agent-label">
            Also delete the agent tasks
          </span>
          <span id="archive-delete-agent-help" className="form-note">
            Deletes the provider sessions they ran in, so they can never be
            continued or resumed.
          </span>
        </div>
        <Switch.Root
          className="switch"
          checked={deleteAgentTasks}
          disabled={pending}
          onCheckedChange={setDeleteAgentTasks}
          aria-labelledby="archive-delete-agent-label"
          aria-describedby="archive-delete-agent-help"
        >
          <Switch.Thumb className="switch-thumb" />
        </Switch.Root>
      </div>
      <div className="archive-delete-actions">
        <Button disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          className="archive-delete-submit"
          disabled={pending}
          onClick={() => onConfirm(deleteAgentTasks)}
        >
          {count === 1 ? "Delete task" : `Delete ${count} tasks`}
        </Button>
      </div>
    </div>
  );
}

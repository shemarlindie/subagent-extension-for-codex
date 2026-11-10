import type { SubmitEvent } from "react";

import { useController } from "../../app/state/controller-context";
import type { WorktreeDialog } from "../../app/state/types";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import { FormFooter } from "../../shared/forms/form-footer";

type WorktreeFormProps = {
  dialog: WorktreeDialog;
};

/** Confirms removing a worktree with uncommitted changes, or deleting a branch. */
function WorktreeForm({ dialog }: WorktreeFormProps) {
  const controller = useController(),
    { action, task, files = [] } = dialog,
    remove = action === "remove";

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    void controller.submit(async () => {
      if (remove) {
        await controller.tool("app_remove_worktree", {
          task_id: task.id,
          force: true,
        });
      } else {
        await controller.tool("app_delete_branch", { task_id: task.id });
      }

      await controller.loadChanges();
      await controller.loadCounts();
    });
  };

  return (
    <form onSubmit={submit}>
      {remove ? (
        <>
          <p className="form-note">
            The worktree has uncommitted changes. Removing it discards them;
            commits stay on branch <code>{task.branch}</code>.
          </p>
          <ul className="worktree-files">
            {files.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="form-note">
          Delete local branch <code>{task.branch}</code> and the commits only it
          holds? Remote branches stay. This can't be undone.
        </p>
      )}
      <FormFooter
        label={remove ? "Discard changes and remove" : "Delete local branch"}
        dismissLabel="Cancel"
      />
    </form>
  );
}

export const worktreeDialog = defineDialog<"worktree">({
  title: ({ action }) =>
    action === "remove" ? "Remove worktree?" : "Delete local branch?",
  render: (dialog) => <WorktreeForm dialog={dialog} />,
});

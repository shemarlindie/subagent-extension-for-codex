import type { FormEvent } from "react";

import { useController } from "../../app/state/controller-context";
import type { DialogState } from "../../app/state/types";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import { FormFooter } from "../../shared/forms/form-footer";

type WorktreeFormProps = {
  dialog: Extract<DialogState, { kind: "worktree" }>;
};

/** Confirms removing a worktree with uncommitted changes, or deleting a branch. */
export function WorktreeForm({ dialog }: WorktreeFormProps) {
  const controller = useController(),
    { action, task, files = [] } = dialog,
    remove = action === "remove";

  const submit = (event: FormEvent) => {
    event.preventDefault();

    void controller.submit(async () => {
      if (remove)
        await controller.tool("remove_user_agent_worktree", {
          task_id: task.id,
          force: true,
        });
      else
        await controller.tool("delete_user_agent_branch", { task_id: task.id });

      await controller.loadChanges();
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
          Delete branch <code>{task.branch}</code> and the commits only it
          holds? This can't be undone.
        </p>
      )}
      <FormFooter
        label={remove ? "Discard changes and remove" : "Delete branch"}
        dismissLabel="Cancel"
      />
    </form>
  );
}

export const worktreeDialog = defineDialog<"worktree">({
  title: ({ action }) =>
    action === "remove" ? "Remove worktree?" : "Delete branch?",
  render: (dialog) => <WorktreeForm dialog={dialog} />,
});

import { Controller, useWatch } from "react-hook-form";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import type { DeleteDialog } from "../../../app/state/types";
import { defineDialog } from "../../../shared/dialogs/dialog-definition";
import { FormFooter } from "../../../shared/forms/form-footer";
import { usePersistedDialogForm } from "../../../shared/forms/use-persisted-dialog-form";
import { AgentTaskDeletionOption } from "./agent-task-deletion-option";
import { TaskDeletionDetails } from "./task-deletion-details";
import { useTaskDeletionPreview } from "./use-task-deletion-preview";

type DeleteTaskFormProps = {
  dialog: DeleteDialog;
};

type DeleteTaskValues = { deleteAgentTask: boolean };

/** Confirms deleting a task, with a choice to delete the provider's session too. */
function DeleteTaskForm({ dialog }: DeleteTaskFormProps) {
  const controller = useController();
  const { task } = dialog;

  const busy = useSnapshot((state) => state.busy);

  const { control, handleSubmit } = usePersistedDialogForm<DeleteTaskValues>(
    "delete",
    {
      deleteAgentTask: false,
    },
  );

  const includeSession = useWatch({ control, name: "deleteAgentTask" });
  const deletion = useTaskDeletionPreview([task.id], includeSession);

  return (
    <form
      onSubmit={controller.handle(
        handleSubmit((values) =>
          controller.submit(
            async () => {
              if (!deletion.confirmation) {
                throw new Error("Review the removal list before deleting.");
              }

              await controller.tool("app_delete_tasks", {
                task_ids: [task.id],
                delete_agent_task: values.deleteAgentTask,
                confirmation: deletion.confirmation,
              });
            },
            false,
            () => controller.back(),
          ),
        ),
      )}
    >
      <p className="form-note">
        Delete this task and the resources listed below? Running work will stop
        first. This can't be undone.
      </p>
      <Controller
        control={control}
        name="deleteAgentTask"
        render={({ field }) => (
          <AgentTaskDeletionOption
            id="delete-agent-task"
            label="Also delete the agent task"
            checked={field.value}
            busy={busy}
            sessionDeletion={deletion.preview?.sessionDeletion}
            onCheckedChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      <TaskDeletionDetails
        preview={deletion.preview}
        checking={deletion.checking}
        error={deletion.error}
        disabled={busy}
        onRefresh={deletion.reload}
      />
      <FormFooter
        variant="danger"
        label="Delete task"
        dismissLabel="Cancel"
        disabled={deletion.checking || !deletion.confirmation}
      />
    </form>
  );
}

export const deleteTaskDialog = defineDialog<"delete">({
  title: () => "Delete task?",
  render: (dialog) => <DeleteTaskForm dialog={dialog} />,
  restoreFocus: () => document.getElementById("task-menu"),
});

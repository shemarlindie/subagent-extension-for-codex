import { Switch } from "@base-ui/react/switch";
import { Controller } from "react-hook-form";

import { defineDialog } from "../../../shared/dialogs/dialog-definition";
import { FormFooter } from "../../../shared/forms/form-footer";
import { usePersistedDialogForm } from "../../../shared/forms/use-persisted-dialog-form";
import { useController } from "../../../shared/state/controller-context";
import type { DialogState } from "../../../shared/state/types";

type DeleteTaskFormProps = {
  dialog: Extract<DialogState, { kind: "delete" }>;
};

type DeleteTaskValues = { deleteAgentTask: boolean };

/** Confirms deleting a task, with a choice to delete the provider's session too. */
export function DeleteTaskForm({ dialog }: DeleteTaskFormProps) {
  const controller = useController(),
    { task } = dialog;

  const { control, handleSubmit } = usePersistedDialogForm<DeleteTaskValues>(
    "delete",
    { deleteAgentTask: false },
  );

  return (
    <form
      onSubmit={handleSubmit((values) =>
        controller.submit(
          async () => {
            await controller.tool("delete_user_agent_task", {
              task_id: task.id,
              delete_agent_task: values.deleteAgentTask,
            });
          },
          false,
          () => controller.back(),
        ),
      )}
    >
      <p className="form-note">
        {["queued", "starting", "running", "waiting"].includes(task.status)
          ? "Stop and delete"
          : "Delete"}{" "}
        this task with its conversation and activity
        {task.workspace_strategy === "worktree" && (
          <>
            , its worktree (uncommitted changes included) and branch{" "}
            <code>{task.branch}</code>
          </>
        )}
        ? This can't be undone.
      </p>
      <div className="delete-option">
        <div className="delete-option-text">
          <span id="delete-agent-task-label">Also delete the agent task</span>
          <span id="delete-agent-task-help" className="form-note">
            Deletes the {task.provider} session this task ran in, so it can
            never be continued or resumed.
          </span>
        </div>
        <Controller
          control={control}
          name="deleteAgentTask"
          render={({ field }) => (
            <Switch.Root
              className="switch"
              checked={field.value}
              onCheckedChange={field.onChange}
              onBlur={field.onBlur}
              aria-labelledby="delete-agent-task-label"
              aria-describedby="delete-agent-task-help"
            >
              <Switch.Thumb className="switch-thumb" />
            </Switch.Root>
          )}
        />
      </div>
      <FormFooter label="Delete task" dismissLabel="Cancel" />
    </form>
  );
}

export const deleteTaskDialog = defineDialog<"delete">({
  title: () => "Delete task?",
  render: (dialog) => <DeleteTaskForm dialog={dialog} />,
  restoreFocus: () => document.getElementById("task-menu"),
});

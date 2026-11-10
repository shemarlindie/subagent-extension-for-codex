import { Switch } from "@base-ui/react/switch";
import { type SubmitEvent, useLayoutEffect, useState } from "react";

import { useController, useSnapshot } from "../../app/state/controller-context";
import type { RemoveProjectDialog } from "../../app/state/types";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import { FormFooter } from "../../shared/forms/form-footer";
import { AgentTaskDeletionOption } from "../tasks/controls/agent-task-deletion-option";
import { TaskDeletionDetails } from "../tasks/controls/task-deletion-details";
import { useTaskDeletionPreview } from "../tasks/controls/use-task-deletion-preview";
import { projectApproved } from "./selectors";

type RemoveProjectFormProps = {
  dialog: RemoveProjectDialog;
};

function RemoveProjectForm({ dialog }: RemoveProjectFormProps) {
  const controller = useController();
  const state = useSnapshot();
  // A reopened confirmation always starts with task records retained.
  const [removeTasks, setRemoveTasks] = useState(false);
  const [deleteAgentTasks, setDeleteAgentTasks] = useState(false);
  const { project } = dialog;

  const deletion = useTaskDeletionPreview(
    { repository: project.repository },
    deleteAgentTasks,
    removeTasks,
  );

  // Only another parent registration survives removal of this entry.
  const hasParentRegistration = projectApproved(
    state.projects.filter(
      (item) =>
        item.kind === "parent" && item.repository !== project.repository,
    ),
    project.repository,
  );

  useLayoutEffect(() => {
    setRemoveTasks(false);
    setDeleteAgentTasks(false);
  }, [dialog]);

  const toggleRemoveTasks = (checked: boolean) => {
    setRemoveTasks(checked);
    if (!checked) setDeleteAgentTasks(false);
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (
      !state.busy &&
      dialog.scope === state.scopeVersion &&
      (!removeTasks || deletion.confirmation)
    ) {
      controller.run(() =>
        controller.manageProject(project.repository, undefined, {
          deleteTasks: removeTasks,
          deleteAgentTasks,
          confirmation: deletion.confirmation,
        }),
      );
    }
  };

  return (
    <form className="remove-project-form" onSubmit={submit}>
      <p>
        Remove <strong>{project.name ?? project.repository}</strong> from saved
        projects?
      </p>
      <code className="managed-project-path">{project.repository}</code>
      <p className="form-note">
        {removeTasks
          ? "The listed task data will also be removed. Your project folder stays."
          : "Only the project registration is removed. Your folder, task data and provider sessions stay."}
      </p>
      <div className="delete-option">
        <div className="delete-option-text">
          <span id="remove-project-tasks-label">
            Also remove extension task data
          </span>
          <span id="remove-project-tasks-help" className="form-note">
            Stops this project's tasks across all chats and removes their
            extension records, worktrees and local branches, including
            uncommitted changes. This can't be undone.
          </span>
        </div>
        <Switch.Root
          className="switch"
          checked={removeTasks}
          disabled={state.busy}
          onCheckedChange={toggleRemoveTasks}
          aria-labelledby="remove-project-tasks-label"
          aria-describedby="remove-project-tasks-help"
        >
          <Switch.Thumb className="switch-thumb" />
        </Switch.Root>
      </div>
      {removeTasks && (
        <>
          <AgentTaskDeletionOption
            id="remove-project-agent-tasks"
            label="Also delete the agent tasks"
            checked={deleteAgentTasks}
            busy={state.busy}
            sessionDeletion={deletion.preview?.sessionDeletion}
            onCheckedChange={setDeleteAgentTasks}
          />
          <TaskDeletionDetails
            preview={deletion.preview}
            checking={deletion.checking}
            error={deletion.error}
            onRefresh={deletion.reload}
            disabled={state.busy}
          />
        </>
      )}
      <p className="form-note">
        {hasParentRegistration &&
          "This project may still be registered through an approved parent folder. "}
        Starting a task may automatically register it again.{" "}
        {project.kind === "parent" &&
          "To prevent this parent approval from returning on restart, remove it from service configuration too."}
      </p>
      <FormFooter
        label={removeTasks ? "Remove project and task data" : "Remove project"}
        disabled={removeTasks && (deletion.checking || !deletion.confirmation)}
      />
    </form>
  );
}

export const removeProjectDialog = defineDialog<"remove-project">({
  title: () => "Remove project?",
  render: (dialog) => <RemoveProjectForm dialog={dialog} />,
  restoreFocus: () => document.getElementById("project-add"),
});

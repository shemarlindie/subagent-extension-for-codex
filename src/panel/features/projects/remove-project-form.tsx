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

  const { projects, busy, scopeVersion } = useSnapshot([
    "projects",
    "busy",
    "scopeVersion",
  ]);

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
    projects.filter(
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
      !busy &&
      dialog.scope === scopeVersion &&
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
      <p className="remove-project-name">
        <strong>{project.name ?? project.repository}</strong>
      </p>
      {!removeTasks && (
        <>
          <code className="managed-project-path">{project.repository}</code>
          <p className="form-note">
            Removes the saved registration. Your folder, task data and provider
            sessions stay.
          </p>
        </>
      )}
      <div className="delete-option">
        <div className="delete-option-text">
          <span id="remove-project-tasks-label">
            Also remove extension task data
          </span>
          <span id="remove-project-tasks-help" className="form-note">
            Across all chats, including worktrees and uncommitted files. Running
            work will stop first. This can't be undone.
          </span>
        </div>
        <Switch.Root
          className="switch"
          checked={removeTasks}
          disabled={busy}
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
            busy={busy}
            sessionDeletion={deletion.preview?.sessionDeletion}
            onCheckedChange={setDeleteAgentTasks}
          />
          <TaskDeletionDetails
            preview={deletion.preview}
            checking={deletion.checking}
            error={deletion.error}
            disabled={busy}
            onRefresh={deletion.reload}
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
        variant="danger"
        label={removeTasks ? "Remove project and tasks" : "Remove project"}
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

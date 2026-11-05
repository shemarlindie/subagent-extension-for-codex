import { Switch } from "@base-ui/react/switch";
import { type SubmitEvent, useLayoutEffect, useState } from "react";

import { useController, useSnapshot } from "../../app/state/controller-context";
import type { DialogState } from "../../app/state/types";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import { FormFooter } from "../../shared/forms/form-footer";
import { projectApproved } from "./selectors";

type RemoveProjectFormProps = {
  dialog: Extract<DialogState, { kind: "remove-project" }>;
};

function RemoveProjectForm({ dialog }: RemoveProjectFormProps) {
  const controller = useController();
  const state = useSnapshot();
  // A reopened confirmation always starts with task records retained.
  const [removeTasks, setRemoveTasks] = useState(false);
  const { project } = dialog;

  // Only another parent registration survives removal of this entry.
  const hasParentRegistration = projectApproved(
    state.projects.filter(
      (item) =>
        item.kind === "parent" && item.repository !== project.repository,
    ),
    project.repository,
  );

  useLayoutEffect(() => setRemoveTasks(false), [dialog]);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!state.busy && dialog.scope === state.scopeVersion) {
      controller.run(() =>
        controller.manageProject(project.repository, undefined, removeTasks),
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
        Only the project registration is removed. Your folder and files stay on
        disk. Task data is kept by default.
      </p>
      <div className="delete-option">
        <div className="delete-option-text">
          <span id="remove-project-tasks-label">
            Also remove extension task data
          </span>
          <span id="remove-project-tasks-help" className="form-note">
            Stops this project's tasks across all chats and removes their
            extension records, worktrees and branches, including uncommitted
            changes. Provider sessions are kept. This can't be undone.
          </span>
        </div>
        <Switch.Root
          className="switch"
          checked={removeTasks}
          disabled={state.busy}
          onCheckedChange={setRemoveTasks}
          aria-labelledby="remove-project-tasks-label"
          aria-describedby="remove-project-tasks-help"
        >
          <Switch.Thumb className="switch-thumb" />
        </Switch.Root>
      </div>
      <p className="form-note">
        {hasParentRegistration &&
          "This project may still be registered through an approved parent folder. "}
        Starting a task may automatically register it again.{" "}
        {project.kind === "parent" &&
          "To prevent this parent approval from returning on restart, remove it from service configuration too."}
      </p>
      <FormFooter
        label={removeTasks ? "Remove project and task data" : "Remove project"}
      />
    </form>
  );
}

export const removeProjectDialog = defineDialog<"remove-project">({
  title: () => "Remove project?",
  render: (dialog) => <RemoveProjectForm dialog={dialog} />,
  restoreFocus: () => document.getElementById("project-add"),
});

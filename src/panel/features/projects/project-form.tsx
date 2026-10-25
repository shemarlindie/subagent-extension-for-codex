import { type SubmitEvent, useEffect, useRef, useState } from "react";

import { useController, useSnapshot } from "../../app/state/controller-context";
import type { DialogState } from "../../app/state/types";
import { Button } from "../../shared/components/button/button";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import { Field } from "../../shared/forms/fields";
import { FormFooter } from "../../shared/forms/form-footer";
import { usePersistedDialogField } from "../../shared/forms/use-persisted-dialog-form";

interface ProjectFormProps {
  dialog: Extract<DialogState, { kind: "project" }>;
}

function ProjectForm({ dialog }: ProjectFormProps) {
  const controller = useController(),
    state = useSnapshot();

  const [repository, setRepository] = usePersistedDialogField(
    dialog.kind,
    "repository",
    ("repository" in dialog ? dialog.repository : undefined) ?? "",
  );

  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);

  // Back can unmount Add while its native picker is still open.
  useEffect(
    () => () => {
      ++request.current;
    },
    [],
  );

  const active = () =>
    controller.getSnapshot().dialog === dialog &&
    controller.getSnapshot().scopeVersion === dialog.scope;

  async function browse() {
    const generation = ++request.current;
    setBrowsing(true);
    setError("");

    try {
      const result = await controller.browseProject();

      if (generation === request.current && active() && result.repository) {
        setRepository(result.repository);
      }
    } catch (error) {
      if (generation === request.current && active()) {
        setError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (generation === request.current && active()) setBrowsing(false);
    }
  }

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!browsing) controller.run(() => controller.registerProject(repository));
  };

  return (
    <form onSubmit={submit}>
      <p className="form-note">
        Adding a repository allows delegated tasks to access it. Enter a path on
        the computer running the service. Browse opens a folder picker on that
        computer.
      </p>
      <Field id="project-repository" label="Repository path">
        <div className="project-path-entry">
          <input
            id="project-repository"
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
            placeholder="/absolute/path/to/repository"
            required
            maxLength={4096}
            disabled={state.busy || browsing}
          />
          <Button
            disabled={state.busy || browsing}
            onClick={() => void browse()}
          >
            {browsing ? "Choosing…" : "Browse…"}
          </Button>
        </div>
      </Field>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <FormFooter label="Add project" disabled={browsing || !repository} />
    </form>
  );
}

export const projectDialog = defineDialog<"project">({
  title: () => "Add project",
  initialFocus: (popup) =>
    popup?.querySelector<HTMLInputElement>("#project-repository") ?? null,
  render: (dialog) => <ProjectForm dialog={dialog} />,
});

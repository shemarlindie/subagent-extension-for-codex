import { useRef, useState } from "react";
import type { DialogState } from "../core/types";
import { useController, useSnapshot } from "../components/controller-context";
import { Button } from "../components/button";
import { Field } from "./fields";
import { FormFooter } from "./form-footer";

interface ProjectFormProps {
  dialog: Extract<DialogState, { kind: "project" }>;
}
export function ProjectForm({ dialog }: ProjectFormProps) {
  const controller = useController(),
    state = useSnapshot();
  const [repository, setRepository] = useState(dialog.repository ?? "");
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const active = () =>
    controller.getSnapshot().dialog === dialog &&
    controller.getSnapshot().scopeVersion === dialog.scope;
  async function browse() {
    const generation = ++request.current;
    setBrowsing(true);
    setError("");
    try {
      const result = await controller.browseProject();
      if (generation === request.current && active() && result.repository)
        setRepository(result.repository);
    } catch (error) {
      if (active())
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (active()) setBrowsing(false);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!browsing)
          controller.run(() => controller.registerProject(repository));
      }}
    >
      <p className="form-note">
        Choose a Git repository on the service host. Adding it allows delegated
        tasks to access this repository. Browse opens a folder dialog on that
        machine.
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

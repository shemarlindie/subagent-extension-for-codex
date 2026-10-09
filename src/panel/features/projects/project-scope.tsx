import { useController, useSnapshot } from "../../app/state/controller-context";
import { projectChoices } from "../../app/state/selectors";
import { Button } from "../../shared/components/button/button";
import { Presence } from "../../shared/components/motion/motion";
import { SelectField } from "../../shared/components/select/select-field";

export function ProjectScope() {
  const controller = useController(),
    state = useSnapshot();

  const choice = projectChoices(state).find(
    (project) => project.repository === state.repository,
  );

  const projectName =
    choice?.name ?? state.repository?.split("/").at(-1) ?? "All projects";

  const disabled = !state.connected || !state.scopeKnown || state.busy;

  return (
    <div className="context-bar" aria-label="Project context">
      {state.conversation ? (
        <strong id="project-name" title={state.repository}>
          {projectName}
        </strong>
      ) : (
        <SelectField
          id="project-scope"
          label="Project scope"
          value={state.repository ?? ""}
          disabled={disabled}
          options={[
            { value: "", label: "All projects" },
            ...projectChoices(state).map((project) => ({
              value: project.repository,
              label:
                project.name ??
                project.repository.split("/").at(-1) ??
                project.repository,
            })),
          ]}
          onValueChange={(value) =>
            controller.run(() => controller.changeProject(value || undefined))
          }
        />
      )}
      {!state.conversation && (
        <Button
          id="add-project"
          disabled={!state.connected || state.busy}
          onClick={() => controller.run(() => controller.browseAndAddProject())}
        >
          Browse
        </Button>
      )}
      {state.projectCandidate && (
        <Button
          variant="ghost"
          disabled={disabled}
          title={state.projectCandidate}
          onClick={() => controller.addProject()}
        >
          Add chat project
        </Button>
      )}
      <Presence show={Boolean(state.error)}>
        {state.error && (
          <span id="error" className="context-error" role="alert">
            {state.error}
          </span>
        )}
      </Presence>
    </div>
  );
}

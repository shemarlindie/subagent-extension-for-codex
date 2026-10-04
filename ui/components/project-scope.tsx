import { projectChoices } from "../core/selectors";
import { Button } from "./button";
import { useController, useSnapshot } from "./controller-context";
import { MotionContent } from "./motion";
import { SelectField } from "./select-field";

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
      <small id="project-path" title={state.repository}>
        <MotionContent changeKey={state.repository}>
          {state.repository ?? "Choose a project to focus delegated work"}
        </MotionContent>
      </small>
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
    </div>
  );
}

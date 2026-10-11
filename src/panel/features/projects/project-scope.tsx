import { canNavigate } from "../../app/navigation/pages";
import { useController, useSnapshot } from "../../app/state/controller-context";
import { projectChoices } from "../../app/state/selectors";
import { Button } from "../../shared/components/button/button";
import { SelectField } from "../../shared/components/select/select-field";

export function ProjectScope() {
  const controller = useController(),
    state = useSnapshot();

  const disabled = !state.connected || !state.scopeKnown || state.busy;

  return (
    <div className="project-scope" aria-label="Project context">
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

      <Button
        id="manage-projects"
        disabled={!canNavigate(state, "projects")}
        onClick={() => controller.manageProjects()}
      >
        Manage
      </Button>
    </div>
  );
}

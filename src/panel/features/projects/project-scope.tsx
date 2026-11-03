import { canNavigate } from "../../app/navigation/pages";
import { useController, useSnapshot } from "../../app/state/controller-context";
import { projectChoices } from "../../app/state/selectors";
import { LookupField } from "../../shared/components/select/lookup-field";
import { projectDisplayName } from "./selectors";

export function ProjectScope() {
  const controller = useController(),
    state = useSnapshot();

  const value = state.repository ?? "",
    selectedOptionKnown =
      value === "" ||
      projectChoices(state).some((project) => project.repository === value),
    loading = !state.projectsLoaded && !selectedOptionKnown;

  const disabled =
    !state.connected ||
    !state.scopeKnown ||
    !state.projectsLoaded ||
    state.busy;

  return (
    <div className="project-scope">
      <LookupField
        id="project-scope"
        label="Project scope"
        itemsLabel="projects"
        appearance="inline"
        value={value}
        disabled={disabled}
        loading={loading}
        loadingLabel="Loading project options"
        placeholder={loading ? "Loading…" : undefined}
        options={[
          { value: "", label: "All projects" },
          ...projectChoices(state).map((project) => ({
            value: project.repository,
            label: projectDisplayName(project),
            description: project.repository,
          })),
        ]}
        onValueChange={(value) =>
          controller.run(() => controller.changeProject(value || undefined))
        }
        action={
          canNavigate(state, "projects")
            ? {
                label: "Manage projects…",
                onSelect: () => controller.manageProjects(),
              }
            : undefined
        }
      />
    </div>
  );
}

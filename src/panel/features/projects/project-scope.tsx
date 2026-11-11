import { canNavigate } from "../../app/navigation/pages";
import { useController, useSnapshot } from "../../app/state/controller-context";
import { projectChoices } from "../../app/state/selectors";
import { LookupField } from "../../shared/components/select/lookup-field";
import { projectDisplayName } from "./selectors";

export function ProjectScope() {
  const controller = useController();

  const {
    repository,
    projects,
    projectsLoaded,
    connected,
    scopeKnown,
    busy,
    manageable,
  } = useSnapshot(
    [
      "repository",
      "projects",
      "projectsLoaded",
      "connected",
      "scopeKnown",
      "busy",
    ],
    (state) => ({ manageable: canNavigate(state, "projects") }),
  );

  const value = repository ?? "";
  const choices = projectChoices({ projects, repository });

  const selectedOptionKnown =
    value === "" || choices.some((project) => project.repository === value);

  const loading = !projectsLoaded && !selectedOptionKnown;

  const disabled = !connected || !scopeKnown || !projectsLoaded || busy;

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
          ...choices.map((project) => ({
            value: project.repository,
            label: projectDisplayName(project),
            description: project.repository,
          })),
        ]}
        onValueChange={(value) =>
          controller.run(() => controller.changeProject(value || undefined))
        }
        action={
          manageable
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

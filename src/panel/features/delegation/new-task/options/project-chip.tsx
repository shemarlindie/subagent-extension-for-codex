import { useController as useFieldController } from "react-hook-form";

import type { Project } from "../../../../app/state/types";
import { ChipSelect } from "../../../../shared/components/select/chip-select";
import { projectDisplayName } from "../../../projects/selectors";
import type { DelegateValues } from "../../delegate-values";

type ProjectChipProps = {
  projects: Project[];
  loading: boolean;
  disabled: boolean;
};

/** Chooses the project when the panel isn't scoped to one. */
export function ProjectChip({ projects, loading, disabled }: ProjectChipProps) {
  const { field } = useFieldController<DelegateValues, "repository">({
    name: "repository",
  });

  return (
    <ChipSelect
      id="new-task-project"
      label="Project"
      placeholder="Choose a project"
      value={field.value}
      onValueChange={field.onChange}
      loading={loading}
      disabled={disabled}
      options={projects.map((project) => ({
        value: project.repository,
        label: projectDisplayName(project),
        description: project.repository,
      }))}
    />
  );
}

import { useEffect, useRef } from "react";
import { useController as useFieldController } from "react-hook-form";

import { useController } from "../../../../app/state/controller-context";
import type { Project } from "../../../../app/state/types";
import { ChipSelect } from "../../../../shared/components/select/chip-select";
import {
  projectDisplayName,
  projectPathLabel,
} from "../../../projects/selectors";
import type { DelegateValues } from "../../delegate-values";

type ProjectChipProps = {
  projects: Project[];
  /** The project last added from this chip's menu. */
  added?: string;
  loading: boolean;
  disabled: boolean;
};

/**
 * Chooses the project when the panel isn't scoped to one. **Add project…**
 * opens the Add project dialog, and the project it adds becomes the choice.
 */
export function ProjectChip({
  projects,
  added,
  loading,
  disabled,
}: ProjectChipProps) {
  const controller = useController(),
    { field } = useFieldController<DelegateValues, "repository">({
      name: "repository",
    }),
    // Starts at the current addition, so a remount keeps the restored choice.
    applied = useRef(added),
    { onChange } = field;

  useEffect(() => {
    if (!added || added === applied.current) return;

    applied.current = added;
    onChange(added);
  }, [added, onChange]);

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
        description: projectPathLabel(project),
      }))}
      action={{
        label: "Add project…",
        icon: "plus",
        onSelect: () => controller.addProject(true),
      }}
    />
  );
}

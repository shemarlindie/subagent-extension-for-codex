import { useFormContext, useWatch } from "react-hook-form";

import type { Task } from "../../../app/state/types";
import { Field } from "../../../shared/forms/fields";
import { FormSelect } from "../../../shared/forms/form-select";
import type { DelegateValues } from "../delegate-values";

interface DependencyFieldProps {
  tasks: Task[];
  loading?: boolean;
  projectsLoading?: boolean;
  disabled?: boolean;
}

export function DependencyField({
  tasks,
  loading = false,
  projectsLoading = false,
  disabled = false,
}: DependencyFieldProps) {
  const { control } = useFormContext<DelegateValues>(),
    repository = useWatch({ control, name: "repository" });

  return (
    <Field id="deps" label="Wait for tasks (optional)">
      <FormSelect
        searchable
        multiple
        control={control}
        name="deps"
        id="deps"
        label="Wait for tasks (optional)"
        itemsLabel="tasks"
        disabled={loading || projectsLoading || disabled}
        loading={loading || projectsLoading}
        loadingLabel={
          projectsLoading
            ? "Loading project options for dependencies"
            : "Loading tasks for dependency options"
        }
        placeholder="No dependencies"
        options={tasks
          .filter((task) => task.repository === repository && !task.archived_at)
          .map((task) => ({ value: task.id, label: task.title }))}
      />
    </Field>
  );
}

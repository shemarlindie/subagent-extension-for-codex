import { useFormContext, useWatch } from "react-hook-form";

import type { Task } from "../../../app/state/types";
import { Field } from "../../../shared/forms/fields";
import { FormSelect } from "../../../shared/forms/form-select";
import type { DelegateValues } from "../delegate-values";
import { useDependencyTasks } from "./use-dependency-tasks";

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
    repository = useWatch({ control, name: "repository" }),
    dependencies = useDependencyTasks(tasks, repository);

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
        disabled={
          loading || dependencies.loading || projectsLoading || disabled
        }
        loading={loading || dependencies.loading || projectsLoading}
        loadingLabel={
          projectsLoading
            ? "Loading project options for dependencies"
            : "Loading tasks for dependency options"
        }
        placeholder="No dependencies"
        options={dependencies.options.map((task) => ({
          value: task.id,
          label: task.title,
        }))}
      />
    </Field>
  );
}

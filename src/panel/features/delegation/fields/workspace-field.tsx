import { useFormContext, useWatch } from "react-hook-form";

import { Field } from "../../../shared/forms/fields";
import { FormSelect } from "../../../shared/forms/form-select";
import { type DelegateValues, pendingPlaceholder } from "../delegate-values";

interface WorkspaceFieldProps {
  settingsReady?: boolean;
  settingsLoading?: boolean;
}

export function WorkspaceField({
  settingsReady = true,
  settingsLoading = false,
}: WorkspaceFieldProps) {
  const { control } = useFormContext<DelegateValues>();
  const value = useWatch({ control, name: "workspace_strategy" });
  const unresolved = !settingsReady && !value;

  return (
    <Field id="workspace-strategy" label="Workspace">
      <FormSelect
        control={control}
        name="workspace_strategy"
        id="workspace-strategy"
        label="Workspace"
        disabled={!settingsReady}
        loading={settingsLoading && unresolved}
        loadingLabel="Loading workspace default"
        placeholder={
          unresolved ? pendingPlaceholder(settingsLoading) : undefined
        }
        options={[
          { value: "worktree", label: "Isolated worktree" },
          {
            value: "current_repo",
            label: "Project folder (uncommitted changes)",
          },
        ]}
      />
    </Field>
  );
}

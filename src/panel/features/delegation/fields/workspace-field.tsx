import { memo } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";

import { Field } from "../../../shared/forms/fields";
import { FormSelect } from "../../../shared/forms/form-select";
import { pendingPlaceholder, type DelegateValues } from "../delegate-values";

interface WorkspaceFieldProps {
  form: UseFormReturn<DelegateValues>;
  settingsReady?: boolean;
  settingsLoading?: boolean;
  /** The project has no commit, so this is the only valid choice. */
  inPlace?: boolean;
}

export const WorkspaceField = memo(function WorkspaceField({
  form: { control },
  settingsReady = true,
  settingsLoading = false,
  inPlace = false,
}: WorkspaceFieldProps) {
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
        options={
          inPlace
            ? [
                {
                  value: "current_repo",
                  label: "Project folder (edits apply directly)",
                },
              ]
            : [
                { value: "worktree", label: "Isolated worktree" },
                {
                  value: "current_repo",
                  label: "Project folder (uncommitted changes)",
                },
              ]
        }
      />
    </Field>
  );
});

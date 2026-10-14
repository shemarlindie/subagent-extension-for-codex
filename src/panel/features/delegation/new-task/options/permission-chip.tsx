import { useController as useFieldController } from "react-hook-form";

import { ChipSelect } from "../../../../shared/components/select/chip-select";
import type { DelegateValues } from "../../delegate-values";
import { shortPermissionLabel } from "../../permission-label";

type PermissionChipProps = {
  /** The provider's native permission modes; absent when it has none. */
  options?: { value: string; label: string }[];
  /** Read-only profiles inspect only, whatever the mode. */
  readOnly: boolean;
  loading: boolean;
  disabled: boolean;
};

/** Chooses the provider's native permission mode for the task. */
export function PermissionChip({
  options,
  readOnly,
  loading,
  disabled,
}: PermissionChipProps) {
  const { field } = useFieldController<DelegateValues, "permission_mode">({
    name: "permission_mode",
  });

  if (!options && !loading) return null;

  return (
    <ChipSelect
      id="new-task-permission"
      label="Permission mode"
      value={readOnly ? "read-only" : field.value}
      onValueChange={field.onChange}
      loading={loading}
      disabled={disabled || readOnly}
      title={
        readOnly
          ? "Read-only profiles inspect without editing files or running commands"
          : undefined
      }
      options={
        readOnly
          ? [{ value: "read-only", label: "Read only" }]
          : (options ?? []).map((option) => ({
              ...option,
              chipLabel: shortPermissionLabel(option.label),
            }))
      }
    />
  );
}

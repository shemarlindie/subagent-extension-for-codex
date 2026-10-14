import { useController as useFieldController } from "react-hook-form";

import { ChipSelect } from "../../../../shared/components/select/chip-select";
import type { DelegateValues } from "../../delegate-values";

type PermissionChipProps = {
  /** The provider's native permission modes; absent when it has none. */
  options?: { value: string; label: string }[];
  /** Read-only profiles inspect only, whatever the mode. */
  readOnly: boolean;
  loading: boolean;
  disabled: boolean;
};

/** "Plan — read only" reads "Plan" on the chip; the menu keeps the detail. */
function shortLabel({ value, label }: { value: string; label: string }) {
  if (value === "inherit") return "Extension setting";
  if (value === "default") return "Ask for approval";

  return label.split(" — ")[0] ?? label;
}

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
              chipLabel: shortLabel(option),
            }))
      }
    />
  );
}

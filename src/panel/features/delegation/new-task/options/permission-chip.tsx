import { useController as useFieldController } from "react-hook-form";

import { shortPermissionLabel } from "../../../../../shared/providers/claude/permissions";
import { ChipSelect } from "../../../../shared/components/select/chip-select";
import type { DelegateValues } from "../../delegate-values";

type PermissionChipProps = {
  /** The provider's native permission modes, absent when it has none. */
  options?: { value: string; label: string; disabled?: boolean }[];
  loading: boolean;
  disabled: boolean;
};

// The chip shortens the longest modes, and its menu keeps their full names.
const chipWords: Record<string, string> = {
  "Ask for approval": "Ask",
  "Bypass permission prompts": "Bypass",
};

function chipText(label: string) {
  return chipWords[label] ?? label;
}

/** The chip's text for a permission mode, if the provider offers it. */
export function permissionChipLabel(
  options: PermissionChipProps["options"],
  value: string,
) {
  const option = options?.find((candidate) => candidate.value === value);

  return option && shortPermissionLabel(option.label);
}

/** Chooses the provider's native permission mode for the task. */
export function PermissionChip({
  options,
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
      value={field.value}
      onValueChange={field.onChange}
      loading={loading}
      disabled={disabled}
      options={(options ?? []).map((option) => ({
        ...option,
        chipLabel: chipText(shortPermissionLabel(option.label)),
      }))}
    />
  );
}

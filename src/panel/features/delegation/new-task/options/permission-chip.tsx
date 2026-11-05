import { useController as useFieldController } from "react-hook-form";

import { shortPermissionLabel } from "../../../../../shared/providers/claude/permissions";
import { ChipSelect } from "../../../../shared/components/select/chip-select";
import type { DelegateValues } from "../../delegate-values";

type PermissionChipProps = {
  /** The provider's native permission modes; absent when it has none. */
  options?: { value: string; label: string; disabled?: boolean }[];
  /** Read-only profiles inspect only, whatever the mode. */
  readOnly: boolean;
  loading: boolean;
  disabled: boolean;
};

// The chip itself shortens the longest modes; its menu keeps their names.
const chipWords: Record<string, string> = {
  "Ask for approval": "Ask",
  "Bypass permission prompts": "Bypass",
};

function chipText(label: string) {
  return chipWords[label] ?? label;
}

/** The mode a locked choice falls back to, since a task can't run it. */
function usableMode(options: PermissionChipProps["options"], value: string) {
  return options?.find((option) => option.value === value)?.disabled
    ? "default"
    : value;
}

/** The chip's text for a permission mode, if the provider offers it. */
export function permissionChipLabel(
  options: PermissionChipProps["options"],
  value: string,
  readOnly: boolean,
) {
  if (readOnly) return "Read only";

  const mode = usableMode(options, value);
  const option = options?.find((candidate) => candidate.value === mode);

  return option && shortPermissionLabel(option.label);
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
      value={readOnly ? "read-only" : usableMode(options, field.value)}
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
              chipLabel: chipText(shortPermissionLabel(option.label)),
            }))
      }
    />
  );
}

import { useEffect } from "react";
import { useController as useFieldController } from "react-hook-form";

import { titleCase } from "../../../../../shared/settings/settings-document";
import { ChipSelect } from "../../../../shared/components/select/chip-select";
import type { DelegateValues } from "../../delegate-values";

type ReasoningChipProps = {
  /** Effort levels the selected model supports. */
  supported: readonly string[];
  /** The effort a default choice inherits. */
  inherited?: string;
  loading: boolean;
  disabled: boolean;
};

/**
 * Chooses a reasoning effort the selected model supports. Switching to a
 * model without the chosen level returns it to the default.
 */
export function ReasoningChip({
  supported,
  inherited,
  loading,
  disabled,
}: ReasoningChipProps) {
  const { field } = useFieldController<DelegateValues, "reasoning_effort">({
      name: "reasoning_effort",
    }),
    { value, onChange } = field,
    unsupported =
      !loading && value && value !== "default" && !supported.includes(value);

  useEffect(() => {
    if (unsupported) onChange("default");
  }, [unsupported, onChange]);

  return (
    <ChipSelect
      id="new-task-reasoning"
      label="Reasoning effort"
      value={value}
      onValueChange={onChange}
      loading={loading}
      disabled={disabled || supported.length === 0}
      title={
        supported.length === 0
          ? "This model doesn't take a reasoning effort"
          : undefined
      }
      options={[
        {
          value: "default",
          label: `Default (${inherited ?? "provider runtime"})`,
          chipLabel: `${titleCase(inherited ?? "default")} effort`,
        },
        ...supported.map((level) => ({
          value: level,
          label: titleCase(level),
          chipLabel: `${titleCase(level)} effort`,
        })),
      ]}
    />
  );
}

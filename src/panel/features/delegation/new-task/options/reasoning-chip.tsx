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
 * The chip's text for an effort; the default reads as the inherited level.
 * A bare "Default" wouldn't say what it is, so that keeps its noun.
 */
export function reasoningChipLabel(value: string, inherited?: string) {
  const level = value === "default" ? inherited : value;

  return level ? titleCase(level) : "Default effort";
}

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
          chipLabel: reasoningChipLabel("default", inherited),
        },
        ...supported.map((level) => ({
          value: level,
          label: titleCase(level),
          chipLabel: reasoningChipLabel(level),
        })),
      ]}
    />
  );
}

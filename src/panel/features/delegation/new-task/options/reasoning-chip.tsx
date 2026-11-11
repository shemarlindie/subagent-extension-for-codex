import { useEffect } from "react";

import { titleCase } from "../../../../../shared/text";
import { ChipSelect } from "../../../../shared/components/select/chip-select";
import { useProfileChoice } from "./use-profile-choice";

type ReasoningChipProps = {
  /** Effort levels the selected model supports. */
  supported: readonly string[];
  /** The effort a default choice inherits. */
  inherited?: string;
  /** Says when a pick isn't saved. */
  footer?: string;
  loading: boolean;
  disabled: boolean;
};

/**
 * The chip's text for an effort; the default reads as the inherited level.
 */
export function reasoningChipLabel(value: string, inherited?: string) {
  const level = value === "default" ? inherited : value;

  return level ? titleCase(level) : "Default";
}

/**
 * Chooses reasoning the selected model supports. Switching to a
 * model without the chosen level returns it to the default.
 */
export function ReasoningChip({
  supported,
  inherited,
  footer,
  loading,
  disabled,
}: ReasoningChipProps) {
  const { field, choose } = useProfileChoice("reasoning_effort");
  const { value, onChange } = field;

  const unsupported =
    !loading && value && value !== "default" && !supported.includes(value);

  useEffect(() => {
    if (unsupported) onChange("default");
  }, [unsupported, onChange]);

  return (
    <ChipSelect
      id="new-task-reasoning"
      label="Reasoning"
      value={value}
      onValueChange={choose}
      loading={loading}
      footer={footer}
      disabled={disabled || supported.length === 0}
      title={
        supported.length === 0
          ? "This model has no reasoning options"
          : undefined
      }
      options={[
        {
          value: "default",
          label: inherited ? `Default (${inherited})` : "Default",
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

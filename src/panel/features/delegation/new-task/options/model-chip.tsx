import type { ModelChoice } from "../../../../../shared/providers/types";
import { ChipSelect } from "../../../../shared/components/select/chip-select";
import { modelName } from "../../setting-labels";
import { useProfileChoice } from "./use-profile-choice";

type ModelChipProps = {
  models: ModelChoice[];
  /** The model a blank choice inherits, from the profile, provider or global default. */
  inherited?: string;
  /** Why the list is shorter than usual. */
  footer?: string;
  loading: boolean;
  disabled: boolean;
};

/** The chip's text for a model choice; blank reads as the inherited model. */
export function modelChipLabel(
  models: ModelChoice[],
  value: string,
  inherited?: string,
) {
  if (value) return modelName(models, value);

  return inherited ? modelName(models, inherited) : "Default model";
}

/**
 * Chooses a discovered model, or the inherited default. Custom model IDs and
 * aliases remain available in the Advanced task dialog.
 */
export function ModelChip({
  models,
  inherited,
  footer,
  loading,
  disabled,
}: ModelChipProps) {
  const { field, choose } = useProfileChoice("model");

  const custom =
    field.value && !models.some((model) => model.value === field.value);

  return (
    <ChipSelect
      id="new-task-model"
      label="Model"
      value={field.value}
      onValueChange={choose}
      loading={loading}
      disabled={disabled}
      footer={footer}
      options={[
        {
          value: "",
          label: inherited
            ? `Default (${modelName(models, inherited)})`
            : "Default",
          chipLabel: modelChipLabel(models, "", inherited),
        },
        ...models
          .filter((model) => model.value !== "default")
          .map((model) => ({
            value: model.value,
            label: model.displayName,
            description: model.description,
          })),
        ...(custom ? [{ value: field.value, label: field.value }] : []),
      ]}
    />
  );
}

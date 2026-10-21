import { useFormContext, useWatch } from "react-hook-form";

import { reasoningLevels } from "../../../../shared/tasks/reasoning";
import type { Defaults, Worker } from "../../../app/state/types";
import { AsyncControl } from "../../../shared/forms/async-control";
import { Field } from "../../../shared/forms/fields";
import { FormSelect } from "../../../shared/forms/form-select";
import { type DelegateValues, pendingPlaceholder } from "../delegate-values";
import { modelDefaults, validateReasoning } from "../model-defaults";
import { ModelAutocomplete } from "./model-autocomplete";

interface ModelFieldsProps {
  defaults: Defaults;
  workers: Worker[];
  settingsReady?: boolean;
  workersReady?: boolean;
  settingsLoading?: boolean;
  workersLoading?: boolean;
}

export function ModelFields({
  defaults,
  workers,
  settingsReady = true,
  workersReady = true,
  settingsLoading = false,
  workersLoading = false,
}: ModelFieldsProps) {
  const { control } = useFormContext<DelegateValues>();

  const [worker, selectedModel, selectedEffort] = useWatch({
    control,
    name: ["worker", "model", "reasoning_effort"],
  });

  const resolved = modelDefaults(defaults, workers, worker, selectedModel),
    { provider, model, reasoning, workerInfo, metadata, supported } = resolved;

  return (
    <>
      <Field id="model" label="Model">
        <AsyncControl
          loading={workersLoading || (settingsLoading && !selectedModel)}
          label="Loading model defaults and available models"
        >
          <ModelAutocomplete
            models={workerInfo?.models ?? []}
            placeholder={
              settingsReady
                ? model || "Worker default"
                : pendingPlaceholder(settingsLoading)
            }
            describedBy="model-help"
            disabled={!settingsReady || !workersReady}
          />
        </AsyncControl>
        <p id="model-help" className="help">
          Leave blank to use {model || "the worker's default"}. Choose a
          discovered model or enter a model ID or provider alias.
          {workerInfo?.model_discovery_error &&
            ` ${workerInfo.model_discovery_error}`}
          {(!metadata ||
            (metadata.supportsEffort !== false &&
              metadata.supportedEffortLevels === undefined)) &&
            " Reasoning support for this model is unknown."}
        </p>
      </Field>
      <Field id="reasoning-effort" label="Reasoning effort">
        <FormSelect
          control={control}
          name="reasoning_effort"
          id="reasoning-effort"
          label="Reasoning effort"
          disabled={!settingsReady || !workersReady}
          loading={
            workersLoading ||
            (settingsLoading &&
              (!selectedEffort || selectedEffort === "default"))
          }
          loadingLabel="Loading reasoning options"
          placeholder={
            !settingsReady && !selectedEffort
              ? pendingPlaceholder(settingsLoading)
              : undefined
          }
          rules={{ validate: (value) => validateReasoning(value, resolved) }}
          options={[
            {
              value: "default",
              label: reasoning ? `Use default (${reasoning})` : "Use default",
            },
            // Stable options preserve the draft when switching providers or correcting an effort.
            ...reasoningLevels.map((level) => ({
              value: level,
              label: supported.some((item) => item === level)
                ? level
                : `${level} (unsupported by ${provider})`,
            })),
          ]}
        />
      </Field>
    </>
  );
}

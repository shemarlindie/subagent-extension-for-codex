import { useFormContext, useWatch } from "react-hook-form";

import { providerMetadata } from "../../../../shared/providers/metadata";
import { reasoningLevels } from "../../../../shared/tasks/reasoning";
import type { Defaults, Worker } from "../../../app/state/types";
import { AsyncControl } from "../../../shared/forms/async-control";
import { Field } from "../../../shared/forms/fields";
import { FormSelect } from "../../../shared/forms/form-select";
import { type DelegateValues, pendingPlaceholder } from "../delegate-values";
import { workerChoice } from "../delegation";
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

  const { provider, profile: role } = workerChoice(worker);

  const model =
    defaults[`${role}_default_model`] ||
    defaults[`${provider}_default_model`] ||
    defaults.default_model;

  const reasoning = [
    defaults[`${role}_default_reasoning_effort`],
    defaults[`${provider}_default_reasoning_effort`],
    defaults.default_reasoning_effort,
  ].find((value) => value && value !== "default");

  const workerInfo = workers.find((item) => item.provider === provider);

  const metadata = workerInfo?.models?.find(
    (item) => item.value === (selectedModel.trim() || model || "default"),
  );

  const supported =
    metadata?.supportsEffort === false
      ? []
      : (metadata?.supportedEffortLevels ??
        providerMetadata(provider, workerInfo?.metadata)?.defaultEffortLevels ??
        reasoningLevels);

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
                ? model || "Provider runtime default"
                : pendingPlaceholder(settingsLoading)
            }
            describedBy="model-help"
            disabled={!settingsReady || !workersReady}
          />
        </AsyncControl>
        <p id="model-help" className="help">
          Leave blank to inherit {model || "the provider runtime default"}.
          Choose a discovered model or enter a model ID or provider alias.
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
          rules={{
            validate: (value) => {
              const resolved = value === "default" ? reasoning : value;

              return (
                !resolved ||
                supported.some((level) => level === resolved) ||
                `Choose a reasoning effort supported by ${provider}${metadata ? ` model ${metadata.value}` : ""}: ${supported.length ? supported.join(", ") : "use the provider runtime default"}.`
              );
            },
          }}
          options={[
            {
              value: "default",
              label: `Use default (${reasoning || "provider runtime"})`,
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

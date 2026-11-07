import { useFormContext, useWatch } from "react-hook-form";

import { profileLabel } from "../../../app/state/selectors";
import type { Worker } from "../../../app/state/types";
import { Field } from "../../../shared/forms/fields";
import { FormFieldError } from "../../../shared/forms/form-field-error";
import { FormSelect } from "../../../shared/forms/form-select";
import { type DelegateValues, pendingPlaceholder } from "../delegate-values";
import { workerChoice } from "../delegation";

interface WorkerFieldProps {
  workers: Worker[];
  loading?: boolean;
  error?: string;
  disabled?: boolean;
}

export function WorkerField({
  workers,
  loading = false,
  error,
  disabled = false,
}: WorkerFieldProps) {
  const { control } = useFormContext<DelegateValues>();
  const selected = useWatch({ control, name: "worker" });

  const readiness = workers.find(
    (worker) => worker.provider === workerChoice(selected).provider,
  )?.readiness;

  return (
    <Field id="worker" label="Worker">
      <FormSelect
        control={control}
        name="worker"
        id="worker"
        label="Worker"
        disabled={
          disabled ||
          loading ||
          !workers.some((worker) => worker.profiles.length)
        }
        loading={loading}
        loadingLabel="Loading available workers"
        placeholder={!selected ? pendingPlaceholder(loading) : undefined}
        options={workers.flatMap((worker) =>
          worker.profiles.map((profile) => ({
            value: `${worker.provider}:${profile}`,
            label: `${worker.provider} · ${profileLabel(profile)}`,
          })),
        )}
      />
      <FormFieldError message={error} />
      <FormFieldError
        message={
          !loading &&
          !error &&
          !workers.some((worker) => worker.profiles.length)
            ? "No workers are available. Check service configuration in Codex."
            : undefined
        }
      />
      <FormFieldError
        id="worker-error"
        message={readiness?.ready === false ? readiness.message : undefined}
      />
    </Field>
  );
}

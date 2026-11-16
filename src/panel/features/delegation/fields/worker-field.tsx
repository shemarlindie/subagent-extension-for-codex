import { memo } from "react";
import { useWatch, type UseFormReturn } from "react-hook-form";

import { profileLabel } from "../../../app/state/selectors";
import type { Worker } from "../../../app/state/types";
import { Field } from "../../../shared/forms/fields";
import { FormFieldError } from "../../../shared/forms/form-field-error";
import { FormSelect } from "../../../shared/forms/form-select";
import { pendingPlaceholder, type DelegateValues } from "../delegate-values";
import { workerChoice } from "../delegation";

interface WorkerFieldProps {
  form: UseFormReturn<DelegateValues>;
  workers: Worker[];
  loading?: boolean;
  error?: string;
  disabled?: boolean;
}

export const WorkerField = memo(function WorkerField({
  form: { control },
  workers,
  loading = false,
  error,
  disabled = false,
}: WorkerFieldProps) {
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
});

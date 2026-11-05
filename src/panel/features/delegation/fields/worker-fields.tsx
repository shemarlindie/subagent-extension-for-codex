import { useFormContext, useWatch } from "react-hook-form";

import { profileLabel } from "../../../app/state/selectors";
import type { Worker } from "../../../app/state/types";
import { AsyncControl } from "../../../shared/forms/async-control";
import { Field } from "../../../shared/forms/fields";
import { FormFieldError } from "../../../shared/forms/form-field-error";
import { FormSelect } from "../../../shared/forms/form-select";
import { type DelegateValues, pendingPlaceholder } from "../delegate-values";
import { workerChoice } from "../delegation";

interface WorkerFieldsProps {
  workers: Worker[];
  loading?: boolean;
  error?: string;
  disabled?: boolean;
  revisionDisabled?: boolean;
  revisionLoading?: boolean;
  /** The project has no commit, so the task has no revision to choose. */
  revisionHidden?: boolean;
}

export function WorkerFields({
  workers,
  loading = false,
  error,
  disabled = false,
  revisionDisabled = false,
  revisionLoading = false,
  revisionHidden = false,
}: WorkerFieldsProps) {
  const { register, control } = useFormContext<DelegateValues>();
  const strategy = useWatch({ control, name: "workspace_strategy" });
  const selected = useWatch({ control, name: "worker" });
  const revision = useWatch({ control, name: "revision" });

  const readiness = workers.find(
    (worker) => worker.provider === workerChoice(selected).provider,
  )?.readiness;

  return (
    <div className="two">
      <div>
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
      </div>
      {!revisionHidden && (
        <div>
          <Field id="revision" label="Revision">
            <AsyncControl
              loading={revisionLoading && !revision}
              label="Resolving repository revision"
            >
              <input
                id="revision"
                disabled={revisionDisabled}
                placeholder={
                  revisionLoading && !revision ? "Loading…" : undefined
                }
                readOnly={strategy === "current_repo"}
                required
                {...register("revision", { required: true })}
              />
            </AsyncControl>
          </Field>
        </div>
      )}
    </div>
  );
}

import { Controller, useFormContext, useWatch } from "react-hook-form";

import { providerMetadata } from "../../../../shared/providers/metadata";
import type { Worker } from "../../../app/state/types";
import { AsyncControl } from "../../../shared/forms/async-control";
import { FormSwitch } from "../../../shared/forms/form-switch";
import type { DelegateValues } from "../delegate-values";
import { workerChoice } from "../delegation";

/** Explains the cost limit for the selected worker, when there is something to explain. */
function costNote(
  provider: Worker | undefined,
  workerResolved: boolean,
  workersReady: boolean,
  mode: string,
) {
  if (!workerResolved) {
    return workersReady
      ? "Choose a worker to see budget support."
      : "Loading budget options.";
  }

  if (mode === "none") return undefined;

  const costBudgetHelp = providerMetadata(
    provider?.provider ?? "",
    provider?.metadata,
  )?.costBudgetHelp;

  if (costBudgetHelp) return costBudgetHelp;

  return provider?.capabilities.cost_budget
    ? undefined
    : "This provider requires No cost limit.";
}

interface BudgetFieldsProps {
  workers: Worker[];
  settingsReady?: boolean;
  workersReady?: boolean;
  settingsLoading?: boolean;
}

export function BudgetFields({
  workers,
  settingsReady = true,
  workersReady = true,
  settingsLoading = false,
}: BudgetFieldsProps) {
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<DelegateValues>();

  const [worker, mode, runtimeMode, cost, runtime] = useWatch({
    control,
    name: ["worker", "costMode", "runtimeMode", "cost", "runtime"],
  });

  const provider = workers.find(
    (item) => item.provider === workerChoice(worker).provider,
  );

  const workerResolved = Boolean(worker && provider);

  return (
    <div className="task-budget-fields" role="group" aria-label="Task limits">
      <div className="setting-row setting-row-inline">
        <span id="cost-mode-label" className="setting-label">
          Cost limit
        </span>
        <div className="setting-control">
          <span
            className="setting-amount"
            data-off={mode !== "limited" || undefined}
          >
            <AsyncControl
              loading={settingsLoading && cost === "" && mode !== "none"}
              label="Loading cost budget defaults"
            >
              <input
                id="cost"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="any"
                disabled={mode !== "limited" || !settingsReady || !workersReady}
                required={mode === "limited"}
                aria-label="Cost limit (USD)"
                aria-describedby="cost-note budget-error"
                {...register("cost", {
                  valueAsNumber: true,
                  validate: (value) =>
                    mode === "none" ||
                    (typeof value === "number" &&
                      Number.isFinite(value) &&
                      value > 0) ||
                    "Cost budget must be greater than zero.",
                })}
              />
            </AsyncControl>
            <span className="setting-unit">USD</span>
          </span>
          <Controller
            control={control}
            name="costMode"
            rules={{
              validate: (value) =>
                value === "none" ||
                Boolean(provider?.capabilities.cost_budget) ||
                "This worker cannot enforce a cost budget. Choose No cost limit.",
            }}
            render={({ field }) => (
              <FormSwitch
                checked={field.value === "limited"}
                onCheckedChange={(checked) =>
                  field.onChange(checked ? "limited" : "none")
                }
                onBlur={field.onBlur}
                id="cost-mode"
                labelId="cost-mode-label"
                describedBy="cost-note budget-error"
                disabled={!settingsReady || !workersReady}
                loading={settingsLoading && !field.value}
              />
            )}
          />
        </div>
      </div>
      <div className="setting-row setting-row-inline">
        <span id="runtime-mode-label" className="setting-label">
          Runtime limit
        </span>
        <div className="setting-control">
          <span
            className="setting-amount"
            data-off={runtimeMode !== "limited" || undefined}
          >
            <AsyncControl
              loading={
                settingsLoading && runtime === "" && runtimeMode !== "none"
              }
              label="Loading runtime limit defaults"
            >
              <input
                id="runtime"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="any"
                disabled={runtimeMode !== "limited" || !settingsReady}
                required={runtimeMode === "limited"}
                aria-label="Runtime limit (mins)"
                aria-describedby="budget-error"
                {...register("runtime", {
                  valueAsNumber: true,
                  validate: (value) =>
                    runtimeMode === "none" ||
                    (typeof value === "number" &&
                      Number.isFinite(value) &&
                      value > 0) ||
                    "Runtime limit must be greater than zero.",
                })}
              />
            </AsyncControl>
            <span className="setting-unit">mins</span>
          </span>
          <Controller
            control={control}
            name="runtimeMode"
            render={({ field }) => (
              <FormSwitch
                checked={field.value === "limited"}
                onCheckedChange={(checked) =>
                  field.onChange(checked ? "limited" : "none")
                }
                onBlur={field.onBlur}
                id="runtime-mode"
                labelId="runtime-mode-label"
                describedBy="budget-error"
                disabled={!settingsReady}
                loading={settingsLoading && !field.value}
              />
            )}
          />
        </div>
      </div>
      <p id="cost-note" className="help">
        {costNote(provider, workerResolved, workersReady, mode)}
      </p>
      <div id="budget-error" className="form-error" role="alert">
        {errors.costMode?.message ??
          errors.runtime?.message ??
          errors.cost?.message}
      </div>
    </div>
  );
}

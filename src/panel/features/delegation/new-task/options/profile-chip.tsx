import {
  useController as useFieldController,
  useFormContext,
} from "react-hook-form";

import { titleCase } from "../../../../../shared/text";
import type { Worker } from "../../../../app/state/types";
import { ChipSelect } from "../../../../shared/components/select/chip-select";
import type { Defaults } from "../../../settings/types";
import { workerProfileIconName } from "../../../tasks/list/worker-profile-icon";
import type { DelegateValues } from "../../delegate-values";
import { profileValues } from "../new-task-values";

type ProfileChipProps = {
  workers: Worker[];
  defaults?: Defaults;
  loading: boolean;
  disabled: boolean;
};

/**
 * Chooses the worker profile. A profile works as a preset: choosing one
 * returns model and reasoning to that profile's saved settings, or to
 * Default where the org's default outranks them, and
 * `useProfileMode` returns the permission mode to its default.
 */
export function ProfileChip({
  workers,
  defaults,
  loading,
  disabled,
}: ProfileChipProps) {
  const { setValue } = useFormContext<DelegateValues>();

  const { field } = useFieldController<DelegateValues, "worker">({
    name: "worker",
  });

  const multipleProviders = workers.length > 1;

  const choose = (worker: string) => {
    const values = profileValues(worker, defaults, workers);

    field.onChange(worker);
    setValue("model", values.model);
    setValue("reasoning_effort", values.reasoning_effort);
  };

  return (
    <ChipSelect
      id="new-task-profile"
      label="Profile"
      value={field.value}
      onValueChange={choose}
      loading={loading}
      disabled={disabled}
      iconOnly
      options={workers.flatMap((worker) =>
        worker.profiles.map((profile) => {
          const label = titleCase(profile);

          return {
            value: `${worker.provider}:${profile}`,
            label: multipleProviders ? `${worker.provider} · ${label}` : label,
            chipLabel: label,
            icon: workerProfileIconName(profile),
          };
        }),
      )}
    />
  );
}

import {
  useController as useFieldController,
  useFormContext,
} from "react-hook-form";

import { titleCase } from "../../../../../shared/settings/settings-document";
import type { Worker } from "../../../../app/state/types";
import { ChipSelect } from "../../../../shared/components/select/chip-select";
import { workerProfileIconName } from "../../../tasks/list/worker-profile-icon";
import type { DelegateValues } from "../../delegate-values";

type ProfileChipProps = {
  workers: Worker[];
  loading: boolean;
  disabled: boolean;
};

/**
 * Chooses the worker profile. A profile works as a preset: choosing one
 * returns model and reasoning to that profile's configured defaults.
 */
export function ProfileChip({ workers, loading, disabled }: ProfileChipProps) {
  const { setValue } = useFormContext<DelegateValues>(),
    { field } = useFieldController<DelegateValues, "worker">({
      name: "worker",
    }),
    multipleProviders = workers.length > 1;

  const choose = (worker: string) => {
    field.onChange(worker);
    setValue("model", "");
    setValue("reasoning_effort", "default");
  };

  return (
    <ChipSelect
      id="new-task-profile"
      label="Profile"
      value={field.value}
      onValueChange={choose}
      loading={loading}
      disabled={disabled}
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

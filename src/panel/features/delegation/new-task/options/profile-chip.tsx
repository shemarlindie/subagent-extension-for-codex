import { useController as useFieldController } from "react-hook-form";

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
 * Chooses the worker profile. A profile works as a preset: model and
 * reasoning left at default follow that profile's configured defaults.
 */
export function ProfileChip({ workers, loading, disabled }: ProfileChipProps) {
  const { field } = useFieldController<DelegateValues, "worker">({
      name: "worker",
    }),
    multipleProviders = workers.length > 1;

  return (
    <ChipSelect
      id="new-task-profile"
      label="Profile"
      value={field.value}
      onValueChange={field.onChange}
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

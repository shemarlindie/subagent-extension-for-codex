import {
  useController as useFieldController,
  useFormContext,
} from "react-hook-form";

import { useController } from "../../../../app/state/controller-context";
import type { DelegateValues } from "../../delegate-values";

/**
 * A profile setting's field, with `choose` for the user's picks: it sets the
 * value and saves it as the selected profile's default. A failed save shows
 * as the form's `root.settings` error.
 */
export function useProfileChoice<Name extends "model" | "reasoning_effort">(
  name: Name,
) {
  const controller = useController(),
    { getValues, setError, clearErrors } = useFormContext<DelegateValues>(),
    { field } = useFieldController<DelegateValues, Name>({ name });

  const choose = (value: string) => {
    field.onChange(value);
    clearErrors("root.settings");

    void controller.newTasks
      .saveProfileSetting(getValues("worker"), name, value)
      .then((failure) => {
        if (failure) setError("root.settings", { message: failure });
      });
  };

  return { field, choose };
}

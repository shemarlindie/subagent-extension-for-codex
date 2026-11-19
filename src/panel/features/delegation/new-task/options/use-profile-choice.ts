import {
  useController as useFieldController,
  useFormContext,
  type PathValue,
} from "react-hook-form";

import { titleCase } from "../../../../../shared/text";
import { useController } from "../../../../app/state/controller-context";
import { quote } from "../../../../app/state/undo-history";
import type { DelegateValues } from "../../delegate-values";
import { workerChoice } from "../../delegation";
import { profileValues } from "../new-task-values";

const SETTING_NAMES = { model: "model", reasoning_effort: "reasoning" };

/** A choice as a label: model IDs stay as written, and levels read "High". */
function choiceName(name: keyof typeof SETTING_NAMES, value: string) {
  if (!value || value === "default") return "Default";

  return name === "model" ? value : titleCase(value);
}

/**
 * A profile setting's field, with `choose` for the user's picks: it sets the
 * value and saves it as the selected profile's default. A failed save shows
 * as the form's `root.settings` error. Undo saves the previous default, and
 * puts the field back while it still shows this pick.
 */
export function useProfileChoice<Name extends "model" | "reasoning_effort">(
  name: Name,
) {
  const controller = useController();

  const { getValues, setValue, setError, clearErrors } =
    useFormContext<DelegateValues>();

  const { field } = useFieldController<DelegateValues, Name>({ name });

  const choose = (value: string) => {
    const previous = getValues(name);
    const worker = getValues("worker");
    const { profile } = workerChoice(worker);

    field.onChange(value);
    clearErrors("root.settings");

    // Saves `to` in place of `from`, failing with the reason.
    const save = async (from: string, to: string) => {
      const failure = await controller.newTasks.saveProfileSetting(
        worker,
        name,
        to,
      );

      if (failure) throw new Error(failure);

      // Both fields hold strings, which the generic path type can't show.
      if (getValues(name) === from) {
        setValue(name, to as PathValue<DelegateValues, Name>);
      }
    };

    // An earlier save may have failed while this one waited, so undo returns
    // to the default saved when this save starts.
    let saved: string = previous;

    const start = () => {
      const defaults = controller.newTasks.savedDefaults();
      if (defaults) saved = profileValues(worker, defaults)[name];

      return controller.newTasks.saveProfileSetting(worker, name, value);
    };

    const saving =
      profile && previous !== value
        ? controller.undo.change(start, (failure) =>
            failure || saved === value
              ? undefined
              : {
                  label: `Set the ${titleCase(profile)} profile's ${SETTING_NAMES[name]} to ${quote(choiceName(name, value))}`,
                  undo: () => save(value, saved),
                  redo: () => save(saved, value),
                },
          )
        : start();

    void saving.then((failure) => {
      if (failure) setError("root.settings", { message: failure });
    });
  };

  return { field, choose };
}

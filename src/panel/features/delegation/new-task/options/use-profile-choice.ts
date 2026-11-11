import {
  type PathValue,
  useController as useFieldController,
  useFormContext,
} from "react-hook-form";

import { titleCase } from "../../../../../shared/text";
import {
  useController,
  useSnapshot,
} from "../../../../app/state/controller-context";
import { quote } from "../../../../app/state/undo-history";
import type { DelegateValues } from "../../delegate-values";
import { workerChoice } from "../../delegation";
import { orgDefaults } from "../../model-defaults";

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
 * puts the field back while it still shows this pick. Under the org's default
 * a saved value wouldn't apply, so the pick stays with the task.
 */
export function useProfileChoice<Name extends "model" | "reasoning_effort">(
  name: Name,
) {
  const controller = useController();
  const workers = useSnapshot((snapshot) => snapshot.workers);

  const { getValues, setValue, setError, clearErrors } =
    useFormContext<DelegateValues>();

  const { field } = useFieldController<DelegateValues, Name>({ name });

  const choose = (value: string) => {
    const previous = getValues(name);
    const worker = getValues("worker");
    const { profile } = workerChoice(worker);

    field.onChange(value);
    clearErrors("root.settings");
    if (orgDefaults(workers, worker)[name]) return;

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

    const saving = controller.newTasks.saveProfileSetting(worker, name, value);

    void saving.then((failure) => {
      if (failure) setError("root.settings", { message: failure });
    });

    if (profile && previous !== value) {
      controller.undo.track(
        saving,
        {
          label: `Set the ${titleCase(profile)} profile's ${SETTING_NAMES[name]} to ${quote(choiceName(name, value))}`,
          undo: () => save(value, previous),
          redo: () => save(previous, value),
        },
        (failure) => !failure,
      );
    }
  };

  return { field, choose };
}

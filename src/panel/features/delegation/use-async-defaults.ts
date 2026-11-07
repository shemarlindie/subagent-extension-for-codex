import { useEffect, useRef } from "react";
import { type UseFormReturn, useWatch } from "react-hook-form";

import { readOnlyProfile } from "../../../shared/providers/claude/permissions";
import type { DelegateValues } from "./delegate-values";
import { workerChoice } from "./delegation";

/**
 * Async defaults fill untouched fields while preserving saved and active
 * edits: a field keeps its value once the user edits it or a draft saved it.
 */
export function useAsyncDefaults(
  form: UseFormReturn<DelegateValues>,
  initialValues: DelegateValues,
  saved: Partial<DelegateValues>,
) {
  const previous = useRef(initialValues);

  useEffect(() => {
    for (const key of Object.keys(initialValues) as (keyof DelegateValues)[]) {
      if (Object.is(initialValues[key], previous.current[key])) continue;

      const field = form.getFieldState(key);
      if (key in saved || field.isDirty || field.isTouched) continue;

      form.setValue(key, initialValues[key], { shouldDirty: false });
    }

    previous.current = initialValues;
  });
}

/**
 * Keeps an untouched permission mode on the selected profile's default: plan
 * mode for a read-only profile, the saved mode for others. Runs after
 * `useAsyncDefaults`, which fills in the saved mode.
 */
export function useProfileMode(
  form: UseFormReturn<DelegateValues>,
  savedMode: string,
  saved: Partial<DelegateValues>,
) {
  const worker = useWatch({ control: form.control, name: "worker" });

  const mode = readOnlyProfile(workerChoice(worker).profile ?? "")
    ? "plan"
    : savedMode;

  useEffect(() => {
    const field = form.getFieldState("permission_mode");

    // Drafts record what this sets too, so a saved default isn't a choice.
    const chosen =
      saved.permission_mode !== undefined &&
      !["plan", savedMode].includes(saved.permission_mode);

    if (chosen || field.isDirty || field.isTouched) return;

    if (form.getValues("permission_mode") !== mode) {
      form.setValue("permission_mode", mode, { shouldDirty: false });
    }
  });
}

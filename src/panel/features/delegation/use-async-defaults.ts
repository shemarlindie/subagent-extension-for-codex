import { useEffect, useRef } from "react";
import type { UseFormReturn } from "react-hook-form";

import type { DelegateValues } from "./delegate-values";

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

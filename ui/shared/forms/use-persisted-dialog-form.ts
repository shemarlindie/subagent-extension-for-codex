import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import {
  type DefaultValues,
  type FieldValues,
  useForm,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";

import { useController } from "../state/controller-context";
import type { PersistedDialog, PersistedDialogDraft } from "../state/types";

function compatible(value: unknown, example: unknown): boolean {
  if (Array.isArray(example)) return Array.isArray(value);
  if (example === null) return value === null;
  if (typeof example === "number")
    return typeof value === "number" && Number.isFinite(value);
  if (typeof example === "boolean") return typeof value === "boolean";
  if (typeof example === "string") return typeof value === "string";
  if (example && typeof example === "object")
    return value !== null && typeof value === "object" && !Array.isArray(value);

  return false;
}

function restoredValues<T extends FieldValues>(
  defaults: DefaultValues<T>,
  draft?: PersistedDialogDraft,
): DefaultValues<T> {
  if (!draft) return defaults;

  const accepted = Object.fromEntries(
    Object.entries(draft).filter(
      ([key, value]) =>
        key in defaults &&
        compatible(value, (defaults as Record<string, unknown>)[key]),
    ),
  );

  return { ...defaults, ...accepted } as DefaultValues<T>;
}

/** Creates an RHF form whose values are saved and restored with its dialog. */
export function usePersistedDialogForm<T extends FieldValues>(
  kind: PersistedDialog["kind"],
  defaultValues: DefaultValues<T>,
  options?: Omit<UseFormProps<T>, "defaultValues">,
): UseFormReturn<T> {
  const controller = useController(),
    form = useForm<T>({
      ...options,
      defaultValues: restoredValues(
        defaultValues,
        controller.getDialogDraft(kind),
      ),
    }),
    { getValues, watch } = form;

  useEffect(() => {
    controller.saveDialogDraft(kind, getValues() as PersistedDialogDraft);

    const subscription = watch((values) => {
      controller.saveDialogDraft(kind, values as PersistedDialogDraft);
    });

    return () => subscription.unsubscribe();
  }, [controller, getValues, kind, watch]);

  return form;
}

/** Persists small component-owned fields such as a path or open section list. */
export function usePersistedDialogField<T>(
  kind: PersistedDialog["kind"],
  name: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const controller = useController(),
    [value, setValue] = useState(() => {
      const draftValue = controller.getDialogDraft(kind)?.[name];

      return compatible(draftValue, initial) ? (draftValue as T) : initial;
    });

  useEffect(() => {
    controller.saveDialogField(kind, name, value);
  }, [controller, kind, name, value]);

  return [value, setValue];
}

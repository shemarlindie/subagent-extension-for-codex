import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type DefaultValues,
  type FieldValues,
  useForm,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";

import { useController } from "../../app/state/controller-context";
import type {
  PersistedDialog,
  PersistedDialogDraft,
} from "../../app/state/types";

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
  options?: Omit<UseFormProps<T>, "defaultValues"> & { ready?: boolean },
): UseFormReturn<T> {
  const { ready = true, ...formOptions } = options ?? {},
    controller = useController(),
    form = useForm<T>({
      ...formOptions,
      defaultValues: restoredValues(
        defaultValues,
        controller.getDialogDraft(kind),
      ),
    }),
    { getValues, reset, watch } = form,
    initialized = useRef(ready);

  // Async forms can render their shell before their defaults arrive. Restore
  // the saved draft only after the data-dependent field set is known.
  useLayoutEffect(() => {
    if (!ready) {
      initialized.current = false;

      return;
    }

    if (!initialized.current) {
      initialized.current = true;
      reset(restoredValues(defaultValues, controller.getDialogDraft(kind)));
    }
  }, [controller, defaultValues, kind, ready, reset]);

  useEffect(() => {
    if (!ready) return;

    controller.saveDialogDraft(kind, getValues() as PersistedDialogDraft);

    const subscription = watch((values) => {
      controller.saveDialogDraft(kind, values as PersistedDialogDraft);
    });

    return () => subscription.unsubscribe();
  }, [controller, getValues, kind, ready, watch]);

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

import {
  type FieldPath,
  type FieldValues,
  useController,
  type UseControllerProps,
} from "react-hook-form";

import {
  MultiSelectField,
  SelectField,
  type SelectFieldProps,
} from "../components/select/select-field";

/** Connect library controls through RHF's supported controlled-field integration. */
export function FormSelect<T extends FieldValues, N extends FieldPath<T>>({
  name,
  control,
  rules,
  multiple,
  ...props
}: UseControllerProps<T, N> &
  Omit<SelectFieldProps, "name" | "invalid" | "triggerRef" | "onBlur"> & {
    multiple?: boolean;
  }) {
  const { field, fieldState } = useController({ name, control, rules });

  const errorId = `${props.id}-error`,
    shared = {
      ...props,
      name: field.name,
      triggerRef: field.ref,
      onBlur: field.onBlur,
      invalid: fieldState.invalid,
      describedBy:
        [props.describedBy, fieldState.error ? errorId : undefined]
          .filter(Boolean)
          .join(" ") || undefined,
    };

  return (
    <>
      {multiple ? (
        <MultiSelectField
          {...shared}
          value={field.value ?? []}
          onValueChange={field.onChange}
        />
      ) : (
        <SelectField
          {...shared}
          value={field.value ?? ""}
          onValueChange={field.onChange}
        />
      )}
      {fieldState.error && (
        <p id={errorId} className="form-error" role="alert">
          {fieldState.error.message ?? "Choose a value before continuing."}
        </p>
      )}
    </>
  );
}

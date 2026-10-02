import type { Ref } from "react";
import { Select } from "@base-ui/react/select";
import { Chevron } from "./chevron";
export type SelectOption = { value: string; label: string };
export type SelectFieldProps = {
  id: string;
  label: string;
  options: SelectOption[];
  disabled?: boolean;
  name?: string;
  placeholder?: string;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  onBlur?(): void;
};
function SelectTrigger({
  id,
  label,
  placeholder,
  required,
  invalid,
  describedBy,
  triggerRef,
  onBlur,
}: SelectFieldProps) {
  return (
    <Select.Trigger
      id={id}
      ref={triggerRef}
      className="select-trigger"
      aria-label={label}
      aria-required={required || undefined}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onBlur={onBlur}
    >
      <Select.Value className="select-value" placeholder={placeholder} />
      <Select.Icon className="select-icon">
        <Chevron />
      </Select.Icon>
    </Select.Trigger>
  );
}
function SelectOptions({ options }: { options: SelectOption[] }) {
  return (
    <Select.Portal>
      <Select.Positioner
        className="select-positioner"
        sideOffset={6}
        align="start"
        alignItemWithTrigger={false}
      >
        <Select.Popup className="select-popup">
          <Select.List>
            {options.length ? (
              options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className="select-item"
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator
                    className="select-check"
                    aria-hidden="true"
                  >
                    ✓
                  </Select.ItemIndicator>
                </Select.Item>
              ))
            ) : (
              <div className="select-empty">No options available</div>
            )}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  );
}
/** Shared styling; Base UI owns positioning, dismissal, focus, and keyboard input. */
export function SelectField(
  props: SelectFieldProps & {
    value: string;
    onValueChange(value: string): void;
  },
) {
  const value =
    props.value === "" && !props.options.some((option) => option.value === "")
      ? null
      : props.value;
  return (
    <Select.Root
      items={props.options}
      value={value}
      name={props.name}
      disabled={props.disabled}
      onValueChange={(next) => props.onValueChange(next ?? "")}
    >
      <SelectTrigger {...props} />
      <SelectOptions options={props.options} />
    </Select.Root>
  );
}
export function MultiSelectField(
  props: SelectFieldProps & {
    value: string[];
    onValueChange(value: string[]): void;
  },
) {
  return (
    <Select.Root<string, true>
      multiple
      items={props.options}
      value={props.value}
      name={props.name}
      disabled={props.disabled}
      onValueChange={props.onValueChange}
    >
      <SelectTrigger {...props} />
      <SelectOptions options={props.options} />
    </Select.Root>
  );
}

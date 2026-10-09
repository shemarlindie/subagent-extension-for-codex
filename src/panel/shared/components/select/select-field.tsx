import { Select } from "@base-ui/react/select";
import type { Ref } from "react";

import { Chevron } from "../chevron";
import { Icon, type IconName } from "../icons/icons";

export type SelectOption = {
  value: string;
  label: string;
  /** Secondary text shown under the label in the menu only. */
  description?: string;
  /** Optional leading icon for the menu option and selected value. */
  icon?: IconName;
};

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
  options,
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
      <Select.Value className="select-value" placeholder={placeholder}>
        {(value) => {
          const option = options.find((item) => item.value === value);

          return option ? (
            <span className="select-value-content">
              {option.icon && (
                <Icon
                  name={option.icon}
                  size={10}
                  className="select-worker-icon"
                />
              )}
              <span className="select-value-label">{option.label}</span>
            </span>
          ) : (
            placeholder
          );
        }}
      </Select.Value>
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
                  <span className="select-item-content">
                    {option.icon && (
                      <Icon
                        name={option.icon}
                        size={10}
                        className="select-worker-icon"
                      />
                    )}
                    <span className="select-item-text">
                      <Select.ItemText>{option.label}</Select.ItemText>
                      {option.description && (
                        <span className="select-item-description">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </span>
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

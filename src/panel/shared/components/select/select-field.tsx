import { Select } from "@base-ui/react/select";
import type { Ref } from "react";

import { Chevron } from "../chevron";
import { Icon, type IconName } from "../icons/icons";
import { LoadingSpinner } from "../loading-spinner/loading-spinner";
import { LookupField } from "./lookup-field";

export type SelectOption = {
  value: string;
  label: string;
  /** Secondary text shown under the label in the menu. */
  description?: string;
  /** Also show the secondary text under the label after selection. */
  showDescriptionInValue?: boolean;
  /** Optional leading icon for the menu option and selected value. */
  icon?: IconName;
};

export type SelectFieldProps = {
  id: string;
  label: string;
  options: SelectOption[];
  searchable?: boolean;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
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
  loading = false,
  loadingLabel,
  placeholder,
  required,
  invalid,
  describedBy,
  triggerRef,
  onBlur,
}: SelectFieldProps) {
  return (
    <>
      <Select.Trigger
        id={id}
        ref={triggerRef}
        className="select-trigger"
        aria-label={label}
        aria-required={required || undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-busy={loading || undefined}
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
                <span
                  className="select-value-text"
                  data-has-description={
                    option.showDescriptionInValue && option.description
                      ? "true"
                      : undefined
                  }
                >
                  <span className="select-value-label">{option.label}</span>
                  {option.showDescriptionInValue && option.description && (
                    <span className="select-value-description">
                      {option.description}
                    </span>
                  )}
                </span>
              </span>
            ) : (
              placeholder
            );
          }}
        </Select.Value>
        <Select.Icon className="select-icon">
          {loading ? (
            <LoadingSpinner className="select-loading-spinner" />
          ) : (
            <Chevron />
          )}
        </Select.Icon>
      </Select.Trigger>
      {loading && (
        <span className="visually-hidden" role="status">
          {loadingLabel ?? `Loading ${label.toLowerCase()}`}
        </span>
      )}
    </>
  );
}

/** The shared dropdown list, reused by compact selects such as `ChipSelect`. */
export function SelectOptions({ options }: { options: SelectOption[] }) {
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
  if (props.searchable) return <LookupField {...props} />;

  const value =
    props.value === "" && !props.options.some((option) => option.value === "")
      ? null
      : props.value;

  return (
    <Select.Root
      items={props.options}
      value={value}
      name={props.name}
      disabled={props.disabled || props.loading}
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
  if (props.searchable) return <LookupField {...props} multiple />;

  return (
    <Select.Root<string, true>
      multiple
      items={props.options}
      value={props.value}
      name={props.name}
      disabled={props.disabled || props.loading}
      onValueChange={props.onValueChange}
    >
      <SelectTrigger {...props} />
      <SelectOptions options={props.options} />
    </Select.Root>
  );
}

import { Combobox } from "@base-ui/react/combobox";
import { useState } from "react";

import { Chevron } from "../chevron";
import { Icon } from "../icons/icons";
import { LoadingSpinner } from "../loading-spinner/loading-spinner";
import { matchesLookupOption } from "./lookup-matching";
import type { SelectFieldProps } from "./select-field";

type LookupFieldProps = SelectFieldProps &
  (
    | {
        multiple?: false;
        value: string;
        onValueChange: (value: string) => void;
      }
    | {
        multiple: true;
        value: string[];
        onValueChange: (value: string[]) => void;
      }
  );

/** Search stays separate from the selected values, including multi-selection. */
export function LookupField(props: LookupFieldProps) {
  const [query, setQuery] = useState("");

  const optionByValue = new Map(
    props.options.map((option) => [option.value, option]),
  );

  const values = new Set(props.multiple ? props.value : [props.value]);
  const selected = props.options.filter((option) => values.has(option.value));

  const label = selected.map((option) => option.label).join(", ");

  const description =
    !props.multiple && selected[0]?.showDescriptionInValue
      ? selected[0].description
      : undefined;

  const items = [...optionByValue.keys()];

  const rootProps = {
    items,
    name: props.name,
    disabled: props.disabled || props.loading,
    inputValue: query,
    onInputValueChange: setQuery,
    onOpenChange: () => setQuery(""),
    itemToStringLabel: (value: string) =>
      optionByValue.get(value)?.label ?? value,
    filter: (value: string, search: string) =>
      matchesLookupOption(
        optionByValue.get(value) ?? { value, label: value },
        search,
      ),
  };

  const content = (
    <>
      <Combobox.Trigger
        id={props.id}
        ref={props.triggerRef}
        className="select-trigger"
        aria-label={props.label}
        aria-required={props.required || undefined}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        aria-busy={props.loading || undefined}
        onBlur={props.onBlur}
      >
        <span
          className="select-value"
          data-placeholder={!selected.length || undefined}
        >
          <span className="select-value-content">
            {!props.multiple && selected[0]?.icon && (
              <Icon
                name={selected[0].icon}
                size={10}
                className="select-worker-icon"
              />
            )}
            <span
              className="select-value-text"
              data-has-description={description ? "true" : undefined}
            >
              <span className="select-value-label">
                {label || props.placeholder}
              </span>
              {description && (
                <span className="select-value-description">{description}</span>
              )}
            </span>
          </span>
        </span>
        <span className="select-icon">
          {props.loading ? (
            <LoadingSpinner className="select-loading-spinner" />
          ) : (
            <Chevron />
          )}
        </span>
      </Combobox.Trigger>
      {props.loading && (
        <span className="visually-hidden" role="status">
          {props.loadingLabel ?? `Loading ${props.label.toLowerCase()}`}
        </span>
      )}
      <Combobox.Portal>
        <Combobox.Positioner
          className="select-positioner"
          sideOffset={6}
          align="start"
        >
          <Combobox.Popup className="select-popup lookup-popup">
            <Combobox.Input
              className="lookup-search"
              aria-label={`Search ${props.label.toLowerCase()}`}
              placeholder="Search…"
            />
            <Combobox.Empty className="select-empty">
              {props.options.length
                ? "No matching options"
                : "No options available"}
            </Combobox.Empty>
            <Combobox.List className="lookup-list">
              {(value: string) => {
                const option = optionByValue.get(value);

                return (
                  <Combobox.Item
                    key={value}
                    value={value}
                    className="select-item"
                  >
                    <span className="select-item-content">
                      {option?.icon && (
                        <Icon
                          name={option.icon}
                          size={10}
                          className="select-worker-icon"
                        />
                      )}
                      <span className="select-item-text">
                        <span>{option?.label}</span>
                        {option?.description && (
                          <span className="select-item-description">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </span>
                    <Combobox.ItemIndicator
                      className="select-check"
                      aria-hidden="true"
                    >
                      ✓
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                );
              }}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </>
  );

  return props.multiple ? (
    <Combobox.Root<string, true>
      {...rootProps}
      multiple
      value={props.value}
      onValueChange={props.onValueChange}
    >
      {content}
    </Combobox.Root>
  ) : (
    <Combobox.Root<string>
      {...rootProps}
      value={props.value === "" && !items.includes("") ? null : props.value}
      onValueChange={(value) => props.onValueChange(value ?? "")}
    >
      {content}
    </Combobox.Root>
  );
}

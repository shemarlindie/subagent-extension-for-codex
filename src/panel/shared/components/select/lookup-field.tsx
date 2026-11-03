import { Combobox } from "@base-ui/react/combobox";
import { useRef, useState } from "react";

import { Chevron } from "../chevron";
import { Icon } from "../icons/icons";
import { LoadingSpinner } from "../loading-spinner/loading-spinner";
import { matchesLookupOption } from "./lookup-matching";
import {
  SELECT_ACTION_VALUE,
  type SelectAction,
  type SelectFieldProps,
  selectTriggerClass,
} from "./select-field";

type LookupFieldProps = SelectFieldProps &
  (
    | {
        multiple?: false;
        value: string;
        onValueChange: (value: string) => void;
        /** Listed last, whatever the search, and run once the list closes. */
        action?: SelectAction;
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

  const action = props.multiple ? undefined : props.action;

  const itemsLabel = props.itemsLabel ?? "options";

  const emptyMessage = props.options.length
    ? `No matching ${itemsLabel}`
    : `No ${itemsLabel} available`;

  const items = [...optionByValue.keys()];
  const listed = action ? [...items, SELECT_ACTION_VALUE] : items;

  // Like ChipSelect, the action waits for the list to close and return focus.
  const actionChosen = useRef(false);

  const choose = (value: string | null) => {
    if (value === SELECT_ACTION_VALUE) actionChosen.current = true;
    else if (!props.multiple) props.onValueChange(value ?? "");
  };

  const rootProps = {
    items: listed,
    name: props.name,
    disabled: props.disabled || props.loading,
    inputValue: query,
    onInputValueChange: setQuery,
    onOpenChange: () => setQuery(""),
    onOpenChangeComplete: (open: boolean) => {
      if (open || !actionChosen.current) return;
      actionChosen.current = false;
      action?.onSelect();
    },
    itemToStringLabel: (value: string) =>
      value === SELECT_ACTION_VALUE
        ? (action?.label ?? value)
        : (optionByValue.get(value)?.label ?? value),
    filter: (value: string, search: string) =>
      value === SELECT_ACTION_VALUE ||
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
        className={selectTriggerClass(props.appearance)}
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
            {action ? (
              <ActionLookupEmpty>{emptyMessage}</ActionLookupEmpty>
            ) : (
              <Combobox.Empty className="select-empty">
                {emptyMessage}
              </Combobox.Empty>
            )}
            <Combobox.List className="lookup-list">
              {(value: string) => {
                if (value === SELECT_ACTION_VALUE && action) {
                  return (
                    // Pinned below the scrolling options so long lists keep it in view.
                    <div
                      key={value}
                      className="lookup-action"
                      role="presentation"
                    >
                      <Combobox.Separator className="select-separator" />
                      <Combobox.Item
                        value={value}
                        className="select-item select-action"
                      >
                        <span className="select-item-content">
                          {action.icon && (
                            <Icon
                              name={action.icon}
                              size={10}
                              className="select-worker-icon"
                            />
                          )}
                          <span>{action.label}</span>
                        </span>
                      </Combobox.Item>
                    </div>
                  );
                }

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
      onValueChange={choose}
    >
      {content}
    </Combobox.Root>
  );
}

/**
 * Combobox.Empty counts the action as a match, so it never shows beside one.
 * This copies its polite status but counts only the options.
 */
function ActionLookupEmpty({ children }: { children: string }) {
  const empty = Combobox.useFilteredItems<string>().every(
    (value) => value === SELECT_ACTION_VALUE,
  );

  return (
    <div className="select-empty" role="status" aria-live="polite" aria-atomic>
      {empty && children}
    </div>
  );
}

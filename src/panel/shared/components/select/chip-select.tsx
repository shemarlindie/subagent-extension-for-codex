import { Select } from "@base-ui/react/select";
import { useRef } from "react";

import { Chevron } from "../chevron";
import { Icon, type IconName } from "../icons/icons";
import { LoadingSpinner } from "../loading-spinner/loading-spinner";
import {
  SELECT_ACTION_VALUE,
  type SelectAction,
  type SelectOption,
  SelectOptions,
} from "./select-field";

type ChipOption = SelectOption & {
  /** Shorter text for the chip itself; the menu shows `label`. */
  chipLabel?: string;
};

type ChipSelectProps = {
  id: string;
  /** What the chip chooses, such as "Model"; announced with the value. */
  label: string;
  options: ChipOption[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  loading?: boolean;
  /** Shown while no option is selected. */
  placeholder?: string;
  /** Explains a disabled chip, or adds detail to an enabled one. */
  title?: string;
  /** A command listed after the options, such as "Add project…". It runs once the menu closes. */
  action?: SelectAction;
  /** A line under the menu's options. */
  footer?: string;
  /**
   * Shows only the selected option's icon. The label stays in the accessible
   * name and tooltip.
   */
  iconOnly?: boolean;
};

/**
 * A compact, pill-shaped select for options beside an input, such as the
 * new-task composer's model and permission choices. Its menu matches
 * `SelectField`'s.
 */
export function ChipSelect({
  id,
  label,
  options,
  value,
  onValueChange,
  disabled = false,
  loading = false,
  placeholder = label,
  title,
  action,
  footer,
  iconOnly = false,
}: ChipSelectProps) {
  const selected = options.find((option) => option.value === value);
  const text = selected ? (selected.chipLabel ?? selected.label) : placeholder;

  // The action waits for the menu to close and return focus to the chip, so
  // a dialog it opens restores focus there.
  const actionChosen = useRef(false);

  const choose = (next: string | null) => {
    if (next === SELECT_ACTION_VALUE) actionChosen.current = true;
    else onValueChange(next ?? "");
  };

  const closed = (open: boolean) => {
    if (open || !actionChosen.current) return;
    actionChosen.current = false;
    action?.onSelect();
  };

  return (
    <Select.Root
      items={options}
      value={selected ? value : null}
      disabled={disabled || loading}
      onValueChange={choose}
      onOpenChangeComplete={closed}
    >
      <Select.Trigger
        id={id}
        className="chip-select"
        aria-label={`${label}: ${loading ? "loading" : text}`}
        aria-busy={loading || undefined}
        title={title ?? `${label}: ${text}`}
        data-placeholder={selected ? undefined : ""}
        data-icon-only={iconOnly || undefined}
      >
        <ChipSelectValue
          icon={selected?.icon}
          text={loading ? label : text}
          loading={loading}
          iconOnly={iconOnly}
        />
      </Select.Trigger>
      <SelectOptions options={options} action={action} footer={footer} />
    </Select.Root>
  );
}

type ChipSelectValueProps = {
  icon?: IconName;
  text: string;
  loading: boolean;
  iconOnly: boolean;
};

/**
 * The chip's icon, text and caret. An icon-only chip keeps the spinner while
 * loading.
 */
function ChipSelectValue({
  icon,
  text,
  loading,
  iconOnly,
}: ChipSelectValueProps) {
  return (
    <>
      {icon && <Icon name={icon} size={12} className="chip-select-icon" />}
      {!iconOnly && <span className="chip-select-value">{text}</span>}
      {(!iconOnly || loading) && (
        <span className="chip-select-caret" aria-hidden="true">
          {loading ? <LoadingSpinner /> : <Chevron size={10} />}
        </span>
      )}
    </>
  );
}

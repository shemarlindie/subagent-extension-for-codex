import { Select } from "@base-ui/react/select";

import { Chevron } from "../chevron";
import { Icon } from "../icons/icons";
import { LoadingSpinner } from "../loading-spinner/loading-spinner";
import { type SelectOption, SelectOptions } from "./select-field";

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
  onValueChange(value: string): void;
  disabled?: boolean;
  loading?: boolean;
  /** Shown while no option is selected. */
  placeholder?: string;
  /** Explains a disabled chip, or adds detail to an enabled one. */
  title?: string;
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
}: ChipSelectProps) {
  const selected = options.find((option) => option.value === value),
    text = selected ? (selected.chipLabel ?? selected.label) : placeholder;

  return (
    <Select.Root
      items={options}
      value={selected ? value : null}
      disabled={disabled || loading}
      onValueChange={(next) => onValueChange(next ?? "")}
    >
      <Select.Trigger
        id={id}
        className="chip-select"
        aria-label={`${label}: ${loading ? "loading" : text}`}
        aria-busy={loading || undefined}
        title={title ?? `${label}: ${text}`}
        data-placeholder={selected ? undefined : ""}
      >
        {selected?.icon && (
          <Icon name={selected.icon} size={10} className="chip-select-icon" />
        )}
        <span className="chip-select-value">{loading ? label : text}</span>
        <span className="chip-select-caret" aria-hidden="true">
          {loading ? <LoadingSpinner /> : <Chevron />}
        </span>
      </Select.Trigger>
      <SelectOptions options={options} />
    </Select.Root>
  );
}

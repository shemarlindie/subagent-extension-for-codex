import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";

import { Icon } from "../icons/icons";

type CheckboxProps = {
  checked: boolean;
  /** Some, but not all, of the items it stands for are selected. */
  indeterminate?: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** A compact checkbox for selecting list items. Its label wraps it. */
export function Checkbox({
  checked,
  indeterminate = false,
  disabled,
  onCheckedChange,
}: CheckboxProps) {
  return (
    <BaseCheckbox.Root
      className="checkbox"
      checked={checked}
      indeterminate={indeterminate}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
    >
      <BaseCheckbox.Indicator className="checkbox-indicator">
        <Icon name={indeterminate ? "minus" : "check"} size={12} />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}

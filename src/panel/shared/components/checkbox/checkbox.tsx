import { Checkbox } from "@base-ui/react/checkbox";

import { Icon } from "../../../shared/components/icons/icons";

type ArchiveCheckboxProps = {
  checked: boolean;
  /** Some, but not all, of the tasks it stands for are selected. */
  indeterminate?: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
};

/** Selects archived tasks in a project's archive. Its label wraps it. */
export function ArchiveCheckbox({
  checked,
  indeterminate = false,
  disabled,
  onCheckedChange,
}: ArchiveCheckboxProps) {
  return (
    <Checkbox.Root
      className="archive-checkbox"
      checked={checked}
      indeterminate={indeterminate}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
    >
      <Checkbox.Indicator className="archive-checkbox-indicator">
        <Icon name={indeterminate ? "minus" : "check"} size={12} />
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}

import { Switch } from "@base-ui/react/switch";
import { type ReactNode, useId } from "react";

import { LoadingSpinner } from "../components/loading-spinner/loading-spinner";

interface FormSwitchProps {
  id?: string;
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onBlur?: () => void;
  labelId?: string;
  describedBy?: string;
  disabled?: boolean;
  loading?: boolean;
  decorative?: boolean;
  /** Text shown beside the switch. Clicking it toggles the switch too. */
  label?: ReactNode;
  /** The switch's name, when its label shows something else, such as its state. */
  ariaLabel?: string;
  /** A tooltip for the switch and its label. */
  title?: string;
}

/** A compact form switch with an in-control loading indicator and an optional label. */
export function FormSwitch({
  id,
  checked,
  onCheckedChange,
  onBlur,
  labelId,
  describedBy,
  disabled = false,
  loading = false,
  decorative = false,
  label,
  ariaLabel,
  title,
}: FormSwitchProps) {
  const generatedLabelId = useId(),
    // The visible label names the switch unless another name is given.
    nameId = label ? (labelId ?? generatedLabelId) : labelId;

  const control = (
    <Switch.Root
      id={id}
      className={`switch${loading ? " form-switch-loading" : ""}`}
      checked={checked}
      onCheckedChange={onCheckedChange}
      onBlur={onBlur}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-hidden={decorative || undefined}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : nameId}
      aria-describedby={describedBy}
    >
      <Switch.Thumb className="switch-thumb" />
      {loading && (
        <span className="form-switch-spinner" aria-hidden="true">
          <LoadingSpinner />
        </span>
      )}
    </Switch.Root>
  );

  if (!label) return control;

  return (
    <label className="form-switch-label" title={title}>
      {control}
      <span id={labelId ?? generatedLabelId}>{label}</span>
    </label>
  );
}

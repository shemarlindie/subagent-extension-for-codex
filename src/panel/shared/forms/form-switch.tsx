import { Switch } from "@base-ui/react/switch";

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
}

/** A compact form switch with an in-control loading indicator. */
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
}: FormSwitchProps) {
  return (
    <Switch.Root
      id={id}
      className={`switch${loading ? " form-switch-loading" : ""}`}
      checked={checked}
      onCheckedChange={onCheckedChange}
      onBlur={onBlur}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-hidden={decorative || undefined}
      aria-labelledby={labelId}
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
}

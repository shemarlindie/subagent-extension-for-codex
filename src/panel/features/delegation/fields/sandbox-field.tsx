import { Controller, useFormContext } from "react-hook-form";

import type { ProviderMetadata } from "../../../../shared/providers/metadata";
import { FormSwitch } from "../../../shared/forms/form-switch";
import type { DelegateValues } from "../delegate-values";

interface SandboxFieldProps {
  /** The worker's native permissions, which may offer a sandbox toggle. */
  permissions: ProviderMetadata["nativePermissions"];
  /** The worker isn't known yet. */
  unresolved: boolean;
  disabled: boolean;
  loading: boolean;
}

/** Turns the worker's Bash sandbox on or off for the task, inline beside its mode. */
export function SandboxField({
  permissions,
  unresolved,
  disabled,
  loading,
}: SandboxFieldProps) {
  const { control } = useFormContext<DelegateValues>();
  const sandbox = permissions?.sandbox;

  if (!sandbox && !unresolved) return null;

  return (
    <div className="sandbox-toggle">
      <Controller
        control={control}
        name="sandbox"
        render={({ field }) => (
          <FormSwitch
            id="sandbox"
            label="Bash sandbox"
            title={sandbox?.help}
            checked={field.value === "on"}
            onCheckedChange={(checked) =>
              field.onChange(checked ? "on" : "off")
            }
            onBlur={field.onBlur}
            describedBy={sandbox ? "sandbox-help" : undefined}
            disabled={disabled}
            loading={loading}
          />
        )}
      />
      {sandbox && (
        <span id="sandbox-help" hidden>
          {sandbox.help}
        </span>
      )}
    </div>
  );
}

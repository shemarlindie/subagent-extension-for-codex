import { useFormContext } from "react-hook-form";

import type { ProviderMetadata } from "../../../../shared/providers/metadata";
import { Presence } from "../../../shared/components/motion/presence";
import { Field } from "../../../shared/forms/fields";
import { FormSelect } from "../../../shared/forms/form-select";
import type { DelegateValues } from "../delegate-values";

interface SandboxFieldProps {
  /** The worker's native permissions, which may offer a sandbox toggle. */
  permissions: ProviderMetadata["nativePermissions"];
  /** The worker isn't known yet. */
  unresolved: boolean;
  disabled: boolean;
  loading: boolean;
}

/** Turns the worker's Bash sandbox on or off for the task. */
export function SandboxField({
  permissions,
  unresolved,
  disabled,
  loading,
}: SandboxFieldProps) {
  const { control } = useFormContext<DelegateValues>(),
    sandbox = permissions?.sandbox;

  return (
    <Presence show={Boolean(sandbox) || unresolved}>
      <Field id="sandbox" label="Bash sandbox">
        <FormSelect
          control={control}
          name="sandbox"
          id="sandbox"
          label="Bash sandbox"
          disabled={disabled}
          loading={loading}
          loadingLabel="Loading sandbox options"
          placeholder={unresolved ? "Loading…" : undefined}
          options={
            unresolved
              ? []
              : [
                  { value: "on", label: "On" },
                  { value: "off", label: "Off" },
                ]
          }
        />
        <p className="help">
          {unresolved ? "Loading sandbox options." : sandbox?.help}
        </p>
      </Field>
    </Presence>
  );
}

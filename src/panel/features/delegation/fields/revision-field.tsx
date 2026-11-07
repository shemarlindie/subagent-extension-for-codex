import { useFormContext, useWatch } from "react-hook-form";

import { AsyncControl } from "../../../shared/forms/async-control";
import { Field } from "../../../shared/forms/fields";
import type { DelegateValues } from "../delegate-values";

interface RevisionFieldProps {
  disabled?: boolean;
  loading?: boolean;
}

/** The commit an isolated worktree starts from. */
export function RevisionField({
  disabled = false,
  loading = false,
}: RevisionFieldProps) {
  const { register, control } = useFormContext<DelegateValues>();
  const revision = useWatch({ control, name: "revision" });

  return (
    <Field id="revision" label="Revision">
      <AsyncControl
        loading={loading && !revision}
        label="Resolving repository revision"
      >
        <input
          id="revision"
          disabled={disabled}
          placeholder={loading && !revision ? "Loading…" : undefined}
          required
          {...register("revision", { required: true })}
        />
      </AsyncControl>
    </Field>
  );
}

import { memo } from "react";
import type { UseFormReturn } from "react-hook-form";

import { Field } from "../../../shared/forms/fields";
import type { DelegateValues } from "../delegate-values";

type DescriptionFieldProps = { form: UseFormReturn<DelegateValues> };

/** The task's first message. */
export const DescriptionField = memo(function DescriptionField({
  form: { register },
}: DescriptionFieldProps) {
  return (
    <Field id="description" label="Description">
      <textarea
        id="description"
        required
        maxLength={20000}
        placeholder="Review the authentication boundary. Cite findings with file paths and suggest next steps."
        {...register("description", { required: true })}
      />
    </Field>
  );
});

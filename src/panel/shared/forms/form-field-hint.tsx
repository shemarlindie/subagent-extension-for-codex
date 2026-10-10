import {
  FormFieldFeedback,
  type FormFieldFeedbackProps,
} from "./form-field-feedback";

type FormFieldHintProps = Omit<FormFieldFeedbackProps, "kind">;

/** Renders supporting field guidance with the shared enter/exit motion. */
export function FormFieldHint({ id, message, className }: FormFieldHintProps) {
  return (
    <FormFieldFeedback
      id={id}
      message={message}
      className={className}
      kind="hint"
    />
  );
}

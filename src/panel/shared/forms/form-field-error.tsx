import {
  FormFieldFeedback,
  type FormFieldFeedbackProps,
} from "./form-field-feedback";

type FormFieldErrorProps = Omit<FormFieldFeedbackProps, "kind">;

/** Renders a field error with alert semantics and shared enter/exit motion. */
export function FormFieldError({
  id,
  message,
  className,
}: FormFieldErrorProps) {
  return (
    <FormFieldFeedback
      id={id}
      message={message}
      className={className}
      kind="error"
    />
  );
}

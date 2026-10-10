import { Presence } from "../components/motion/motion";

export interface FormFieldFeedbackProps {
  id?: string;
  message?: string;
  className?: string;
  kind: "error" | "hint";
}

/** Shares the accessible markup and enter/exit motion for field messages. */
export function FormFieldFeedback({
  id,
  message,
  className,
  kind,
}: FormFieldFeedbackProps) {
  const classes = [
    "form-field-feedback",
    kind === "error" ? "form-error form-field-error" : "form-field-hint",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Presence show={Boolean(message)}>
      <p
        id={id}
        className={classes}
        role={kind === "error" ? "alert" : undefined}
      >
        {message}
      </p>
    </Presence>
  );
}

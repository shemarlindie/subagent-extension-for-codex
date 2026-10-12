interface LoadingSpinnerProps {
  className?: string;
}

/** Decorative spinner shared by controls that already expose loading status. */
export function LoadingSpinner({ className }: LoadingSpinnerProps) {
  return (
    <span
      className={["loading-spinner", className].filter(Boolean).join(" ")}
      aria-hidden="true"
    />
  );
}

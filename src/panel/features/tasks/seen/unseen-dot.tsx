type UnseenDotProps = { className?: string };

/** Marks a task with something the user hasn't seen; screen readers hear "Unseen". */
export function UnseenDot({ className }: UnseenDotProps) {
  return (
    <span className={className ? `unseen-dot ${className}` : "unseen-dot"}>
      <span className="unseen-dot-label">Unseen</span>
    </span>
  );
}

type UnreadDotProps = { className?: string };

/** Marks a task with something the user hasn't read; screen readers hear "Unread". */
export function UnreadDot({ className }: UnreadDotProps) {
  return (
    <span className={className ? `unread-dot ${className}` : "unread-dot"}>
      <span className="unread-dot-label">Unread</span>
    </span>
  );
}

type ProgressBarProps = {
  /** How full the bar is, from 0 to 1. Values above 1 show a full bar. */
  value: number;
};

/**
 * Decorative bar that fills from the left in the current color, as wide as
 * its container allows. Pair it with text or a label that states the value.
 */
export function ProgressBar({ value }: ProgressBarProps) {
  return (
    <span className="progress-bar" aria-hidden="true">
      <span
        className="progress-bar-fill"
        style={{ width: `${Math.min(value, 1) * 100}%` }}
      />
    </span>
  );
}

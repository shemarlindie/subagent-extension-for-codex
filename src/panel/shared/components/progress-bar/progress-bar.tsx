type ProgressBarProps = {
  /** How full the bar is, from 0 to 1. Values above 1 show a full bar. */
  value: number;
  /** Where to draw a tick, from 0 to 1, such as an expected value to compare against. */
  marker?: number;
};

/**
 * Decorative bar that fills from the left in the current color, as wide as
 * its container allows. Pair it with text or a label that states the value.
 */
export function ProgressBar({ value, marker }: ProgressBarProps) {
  return (
    <span className="progress-bar" aria-hidden="true">
      <span
        className="progress-bar-fill"
        style={{ width: `${Math.min(value, 1) * 100}%` }}
      />
      {marker !== undefined && (
        <span
          className="progress-bar-marker"
          style={{ left: `${Math.min(marker, 1) * 100}%` }}
        />
      )}
    </span>
  );
}

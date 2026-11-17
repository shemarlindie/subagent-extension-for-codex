type ProgressRingProps = {
  /** How full the ring is, from 0 to 1. Values above 1 show a full ring. */
  value: number;
  size?: number;
};

/** Radius of the ring in its 12-unit viewBox, inside the 2-unit stroke. */
const RADIUS = 4.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Decorative ring that fills clockwise from the top in the current color.
 * Pair it with text or a label that states the value.
 */
export function ProgressRing({ value, size = 12 }: ProgressRingProps) {
  const filled = Math.min(value, 1) * CIRCUMFERENCE;

  return (
    <svg
      className="progress-ring"
      width={size}
      height={size}
      viewBox="0 0 12 12"
      aria-hidden="true"
    >
      <circle className="progress-ring-track" cx="6" cy="6" r={RADIUS} />
      <circle
        className="progress-ring-fill"
        cx="6"
        cy="6"
        r={RADIUS}
        strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
      />
    </svg>
  );
}

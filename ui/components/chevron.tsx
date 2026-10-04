/** A square viewport keeps rotating chevrons from changing their layout footprint. */
export function Chevron({ square = false }: { square?: boolean }) {
  return (
    <span
      className={`chevron${square ? " chevron-square" : ""}`}
      aria-hidden="true"
    >
      {/* Cropped stroke bounds retain the original 14px / 16-unit scale. */}
      <svg
        width="8.3125"
        height={square ? 8.3125 : 4.8125}
        viewBox={square ? "3.25 3.25 9.5 9.5" : "3.25 5.25 9.5 5.5"}
        fill="none"
        aria-hidden="true"
      >
        <path
          d="m4 6 4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

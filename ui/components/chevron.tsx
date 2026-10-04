import { Icon } from "./icons";

/** A square viewport keeps rotating chevrons from changing their layout footprint. */
export function Chevron({ square = false }: { square?: boolean }) {
  return (
    <span
      className={`chevron${square ? " chevron-square" : ""}`}
      aria-hidden="true"
    >
      <Icon name="chevron-down" square={square} />
    </span>
  );
}

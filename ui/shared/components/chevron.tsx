import { Icon } from "./icons";

/** A shared square viewport keeps rotating chevrons from changing layout. */
export function Chevron({ size = 12 }: { size?: number }) {
  return (
    <span className="chevron" aria-hidden="true">
      <Icon name="chevron-down" size={size} />
    </span>
  );
}

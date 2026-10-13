import { Icon } from "../icons/icons";
import { Presence } from "../motion/motion";

type ScrollLatestDirection = "up" | "down";

export interface ScrollLatestButtonProps {
  show: boolean;
  /** Where the latest content sits, so the chevron points toward it. */
  direction: ScrollLatestDirection;
  /** Accessible name and tooltip. */
  label: string;
  /** Positions the button within its owner. */
  className?: string;
  onClick: () => void;
}

/** A floating button that returns a scrolled view to its latest content. */
export function ScrollLatestButton({
  show,
  direction,
  label,
  className,
  onClick,
}: ScrollLatestButtonProps) {
  return (
    <Presence show={show} variant="pop">
      <button
        type="button"
        className={
          className
            ? `scroll-latest-button ${className}`
            : "scroll-latest-button"
        }
        data-direction={direction}
        aria-label={label}
        title={label}
        onClick={onClick}
      >
        <Icon name="chevron-down" size={12} />
      </button>
    </Presence>
  );
}

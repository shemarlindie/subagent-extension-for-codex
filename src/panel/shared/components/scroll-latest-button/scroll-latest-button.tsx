import type { ReactNode } from "react";

import { Icon } from "../icons/icons";
import { Presence } from "../motion/presence";

type ScrollLatestDirection = "up" | "down";

export interface ScrollLatestButtonProps {
  show: boolean;
  /** Where the latest content sits, so the chevron points toward it. */
  direction: ScrollLatestDirection;
  /** Accessible name and tooltip. */
  label: string;
  /** Positions the button within its owner. */
  className?: string;
  /** A marker over the button's corner, such as a dot for unread content. */
  badge?: ReactNode;
  onClick: () => void;
}

/** A floating button that returns a scrolled view to its latest content. */
export function ScrollLatestButton({
  show,
  direction,
  label,
  className,
  badge,
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
        {badge}
      </button>
    </Presence>
  );
}

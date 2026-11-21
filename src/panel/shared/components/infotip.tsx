import { Popover } from "@base-ui/react/popover";
import type { ReactElement, ReactNode } from "react";

type InfotipProps = {
  children: ReactElement;
  onOpenChange?: (open: boolean) => void;
} & (
  | { label: string; triggerLabel?: string }
  | { label: ReactNode; triggerLabel: string }
);

/**
 * A note for an info trigger. It looks like a tooltip, but Base UI disables
 * tooltips on touch, so a popover lets tap and click open it too.
 */
export function Infotip({
  label,
  children,
  triggerLabel,
  onOpenChange,
}: InfotipProps) {
  return (
    <Popover.Root onOpenChange={onOpenChange}>
      <Popover.Trigger
        openOnHover
        delay={250}
        aria-label={
          triggerLabel ?? (typeof label === "string" ? label : undefined)
        }
        render={children}
      />
      <Popover.Portal>
        <Popover.Positioner className="tooltip-positioner" sideOffset={6}>
          {/* The note has nothing to focus, so focus stays on the trigger. */}
          <Popover.Popup
            className={
              typeof label === "string"
                ? "tooltip-popup"
                : "tooltip-popup tooltip-popup-rich"
            }
            initialFocus={false}
            aria-label={triggerLabel}
          >
            {label}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

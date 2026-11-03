import { Popover } from "@base-ui/react/popover";
import type { ReactElement } from "react";

type InfotipProps = {
  label: string;
  children: ReactElement;
  triggerLabel?: string;
};

/**
 * A note for an info trigger. It looks like a tooltip, but Base UI disables
 * tooltips on touch, so a popover lets tap and click open it too.
 */
export function Infotip({ label, children, triggerLabel }: InfotipProps) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={250}
        aria-label={triggerLabel ?? label}
        render={children}
      />
      <Popover.Portal>
        <Popover.Positioner className="tooltip-positioner" sideOffset={6}>
          {/* The note has nothing to focus, so focus stays on the trigger. */}
          <Popover.Popup className="tooltip-popup" initialFocus={false}>
            {label}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

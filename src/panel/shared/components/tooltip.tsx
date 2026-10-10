import { Tooltip } from "@base-ui/react/tooltip";
import { type ReactElement, useEffect, useState } from "react";

interface TooltipWrapperProps {
  label: string;
  children: ReactElement;
}

export function TooltipWrapper({ label, children }: TooltipWrapperProps) {
  const [open, setOpen] = useState(false);

  // A scroll moves the trigger away from its tooltip, so close at once. Capture
  // catches scrolling in any container, since scroll events do not bubble.
  useEffect(() => {
    if (!open) return;

    const close = () => setOpen(false);

    document.addEventListener("scroll", close, {
      capture: true,
      passive: true,
    });

    return () =>
      document.removeEventListener("scroll", close, { capture: true });
  }, [open]);

  return (
    <Tooltip.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Trigger delay={250} aria-label={label} render={children} />
      {/* Mounted only while open: a closing popup would otherwise linger through its exit state. */}
      {open && (
        <Tooltip.Portal>
          <Tooltip.Positioner className="tooltip-positioner" sideOffset={6}>
            <Tooltip.Popup className="tooltip-popup" role="tooltip">
              {label}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      )}
    </Tooltip.Root>
  );
}

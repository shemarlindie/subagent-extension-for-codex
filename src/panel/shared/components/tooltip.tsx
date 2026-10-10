import { Tooltip } from "@base-ui/react/tooltip";
import { type ReactElement, useCallback, useEffect, useState } from "react";

interface TooltipWrapperProps {
  label: string;
  children: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerLabel?: string;
  popupClassName?: string;
  arrow?: boolean;
  sideOffset?: number;
}

export function TooltipWrapper({
  label,
  children,
  open: controlledOpen,
  onOpenChange,
  triggerLabel,
  popupClassName,
  arrow = false,
  sideOffset = 6,
}: TooltipWrapperProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;

  const changeOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      else onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  // A scroll moves the trigger away from its tooltip, so close at once. Capture
  // catches scrolling in any container, since scroll events do not bubble.
  useEffect(() => {
    if (!open) return;

    const close = () => changeOpen(false);

    document.addEventListener("scroll", close, {
      capture: true,
      passive: true,
    });

    return () =>
      document.removeEventListener("scroll", close, { capture: true });
  }, [changeOpen, open]);

  return (
    <Tooltip.Root open={open} onOpenChange={changeOpen}>
      <Tooltip.Trigger
        delay={250}
        aria-label={triggerLabel ?? label}
        render={children}
      />
      {/* Mounted only while open: a closing popup would otherwise linger through its exit state. */}
      {open && (
        <Tooltip.Portal>
          <Tooltip.Positioner
            className="tooltip-positioner"
            sideOffset={sideOffset}
          >
            <Tooltip.Popup
              className={
                popupClassName
                  ? `tooltip-popup ${popupClassName}`
                  : "tooltip-popup"
              }
              role="tooltip"
            >
              {arrow && (
                <Tooltip.Arrow className="tooltip-arrow" aria-hidden="true" />
              )}
              {label}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      )}
    </Tooltip.Root>
  );
}

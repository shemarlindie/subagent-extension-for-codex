import { Tooltip } from "@base-ui/react/tooltip";
import type { ReactElement } from "react";

interface TooltipWrapperProps {
  label: string;
  children: ReactElement;
}

export function TooltipWrapper({ label, children }: TooltipWrapperProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger delay={250} aria-label={label} render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner className="tooltip-positioner" sideOffset={6}>
          <Tooltip.Popup className="tooltip-popup" role="tooltip">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

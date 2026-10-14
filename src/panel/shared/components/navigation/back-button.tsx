import type { ComponentProps } from "react";

import { Button } from "../button/button";
import { Icon } from "../icons/icons";
import { TooltipWrapper } from "../tooltip";

type BackButtonProps = Omit<
  ComponentProps<typeof Button>,
  "children" | "variant" | "underline"
> & {
  label: string;
};

export function BackButton({ label, className, ...props }: BackButtonProps) {
  return (
    <TooltipWrapper label={`Back to ${label}`} triggerLabel={label}>
      <Button
        {...props}
        variant="ghost"
        className={["toolbar-icon-button", "back", className]
          .filter(Boolean)
          .join(" ")}
      >
        <Icon name="chevron-down" className="back-caret" />
      </Button>
    </TooltipWrapper>
  );
}

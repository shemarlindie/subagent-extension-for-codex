import type { ComponentProps } from "react";

import { Button } from "../button/button";

type BackButtonProps = Omit<
  ComponentProps<typeof Button>,
  "children" | "variant" | "underline"
> & {
  label: string;
};

export function BackButton({ label, className, ...props }: BackButtonProps) {
  return (
    <Button
      {...props}
      variant="ghost"
      className={["back", className].filter(Boolean).join(" ")}
    >
      <span aria-hidden="true">← </span>
      {label}
    </Button>
  );
}

import type { ButtonHTMLAttributes } from "react";

interface QuietButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Underlines the label so a text-only button reads as a link. */
  underline?: boolean;
}

/** A low-emphasis button: muted text that brightens on hover, with no fill. */
export function QuietButton({
  underline = false,
  className,
  ...rest
}: QuietButtonProps) {
  return (
    <button
      type="button"
      className={["quiet-button", underline && "underline", className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
}

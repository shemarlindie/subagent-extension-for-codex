import type { ComponentProps } from "react";

/**
 * - `default`: bordered; the secondary action beside a primary one.
 * - `primary`: filled; the action that submits or confirms.
 * - `ghost`: borderless until hovered; toolbar and navigation buttons.
 * - `text`: muted text with no box; low-emphasis inline actions.
 */
export type ButtonVariant = "default" | "primary" | "ghost" | "text";

// Only text buttons read as links, so only they take an underline.
type VariantProps =
  | { variant?: "default" | "primary" | "ghost"; underline?: never }
  | { variant: "text"; underline?: boolean };

// ComponentProps includes `ref`, which React 19 passes through like any other prop.
export type ButtonProps = Omit<ComponentProps<"button">, "type"> & {
  /** Defaults to "button", so submitting a form is always explicit. */
  type?: "button" | "submit";
} & VariantProps;

// Default buttons use the themes' plain `button` rule, so they need no class.
const VARIANT_CLASSES: Record<ButtonVariant, string | undefined> = {
  default: undefined,
  primary: "primary",
  ghost: "ghost",
  text: "text-button",
};

/**
 * Classes for a variant, for components that render their own button
 * (such as Base UI's Dialog.Close or Menu.Trigger).
 */
export function buttonClass(
  variant: ButtonVariant = "default",
  {
    underline = false,
    className,
  }: { underline?: boolean; className?: string } = {},
) {
  return (
    [
      VARIANT_CLASSES[variant],
      variant === "text" && underline && "underline",
      className,
    ]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

export function Button({
  variant = "default",
  underline,
  type = "button",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClass(variant, { underline, className })}
      {...rest}
    />
  );
}

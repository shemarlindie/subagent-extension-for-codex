import type { Key, ReactNode } from "react";

type MotionTag = "span" | "strong" | "div";

type MotionVariant = "swap" | "rise";

interface MotionContentProps {
  changeKey: Key | null | undefined;
  as?: MotionTag;
  variant?: MotionVariant;
  className?: string;
  children: ReactNode;
}

/** Replaces changing content with a keyed element that enters using the shared motion style. */
export function MotionContent({
  changeKey,
  as: Tag = "span",
  variant = "swap",
  className,
  children,
}: MotionContentProps) {
  const classes = [`motion-${variant}`, className].filter(Boolean).join(" ");

  return (
    <Tag key={changeKey} className={classes}>
      {children}
    </Tag>
  );
}

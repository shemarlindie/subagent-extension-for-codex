/** Matches the CSS motion tokens in ui/styles/shared/motion.css. */
export const MOTION = {
  fast: 120,
  base: 180,
  slow: 240,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
} as const;

export function reducedMotion(element?: Element | null) {
  const view = element?.ownerDocument.defaultView ?? window;

  return view.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// Without the Web Animations API (or with reduced motion), changes apply at once.
export function canAnimate(element: Element | null | undefined) {
  return (
    !!element &&
    typeof (element as HTMLElement).animate === "function" &&
    !reducedMotion(element)
  );
}

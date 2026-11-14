/** Shared panel motion values, mirrored by the CSS tokens in motion.css. */
export const MOTION = {
  fast: 120,
  base: 180,
  slow: 240,
  /**
   * LoadingSwap's skeleton-to-content cross-fade, mirrored by CSS.
   */
  loadingCrossfade: 300,
  easing: "cubic-bezier(0.2, 0, 0, 1)",
} as const;

export function reducedMotion(element?: Element | null) {
  const view = element?.ownerDocument.defaultView ?? window;

  // jsdom, which runs the panel tests, has no matchMedia.
  return (
    typeof view.matchMedia === "function" &&
    view.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Without the Web Animations API (or with reduced motion), changes apply at once.
export function canAnimate(
  element: Element | null | undefined,
): element is HTMLElement {
  return (
    !!element &&
    typeof (element as HTMLElement).animate === "function" &&
    !reducedMotion(element)
  );
}

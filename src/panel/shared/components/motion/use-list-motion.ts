import { type RefObject, useLayoutEffect, useRef } from "react";

import { canAnimate, MOTION } from "./motion-utils";

/**
 * Slides keyed children (matched by `attribute`) from their previous position when
 * `key` changes, so rows that reorder or close a gap move instead of jumping.
 * Newly arrived rows are left to their own CSS entrance.
 */
export function useListMotion(
  ref: RefObject<HTMLElement | null>,
  attribute: string,
  key: unknown,
  duration: number = MOTION.slow,
) {
  const tops = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;

    const previous = tops.current;
    const next = new Map<string, number>();
    const animations: Animation[] = [];

    const motion = canAnimate(container);
    // Relative to the list, so layout shifts above it never read as row movement.
    const origin = container.getBoundingClientRect().top - container.scrollTop;

    for (const element of Array.from(
      container.querySelectorAll<HTMLElement>(`[${attribute}]`),
    )) {
      const id = element.getAttribute(attribute)!;
      const top = element.getBoundingClientRect().top - origin;

      next.set(id, top);
      const old = previous.get(id);
      if (!motion || old === undefined || Math.abs(old - top) < 1) continue;

      animations.push(
        element.animate(
          [{ transform: `translateY(${old - top}px)` }, { transform: "none" }],
          { duration, easing: MOTION.easing },
        ),
      );
    }

    tops.current = next;

    return () => animations.forEach((animation) => animation.cancel());
  }, [ref, attribute, key, duration]);
}

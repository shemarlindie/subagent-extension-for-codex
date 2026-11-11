import { type RefObject, useLayoutEffect, useRef } from "react";

import { canAnimate, MOTION } from "./motion-utils";

/**
 * Animates an element's height when `key` changes its size, so content that grows
 * or shrinks in place (a clamp opening, a dialog switching forms) eases instead of jumping.
 */
export function useAnimatedHeight(
  ref: RefObject<HTMLElement | null>,
  key: unknown,
  /** Starts newly arriving content at zero height. Initial history omits this. */
  appear = false,
) {
  const height = useRef<number | undefined>(undefined);
  const animating = useRef(false);

  const observed = useRef<{ element: HTMLElement; observer?: ResizeObserver }>(
    undefined,
  );

  // Track unrelated size changes (such as a resize) so the next change starts from the real height.
  // The element can mount later (a dialog popup), so check it after every render.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === observed.current?.element) return;
    observed.current?.observer?.disconnect();
    observed.current = undefined;
    // A new element gets its own baseline, never a predecessor's height.
    height.current = undefined;
    if (!element) return;
    height.current = appear ? 0 : element.offsetHeight;

    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            if (!animating.current) height.current = element.offsetHeight;
          });

    observer?.observe(element);
    observed.current = { element, observer };
  });

  useLayoutEffect(() => () => observed.current?.observer?.disconnect(), []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const from = height.current;
    const to = element.offsetHeight;

    height.current = to;

    if (from === undefined || Math.abs(from - to) < 1 || !canAnimate(element)) {
      return;
    }

    animating.current = true;

    const animation = element.animate(
      [
        { height: `${from}px`, overflow: "hidden" },
        { height: `${to}px`, overflow: "hidden" },
      ],
      { duration: MOTION.base, easing: MOTION.easing },
    );

    let finished = false;

    animation.onfinish = () => {
      finished = true;
      animating.current = false;
      height.current = element.offsetHeight;
    };

    return () => {
      // Interrupted: the next change starts from where this one had reached.
      // Cleanup runs after the DOM changed, so read the size the animation still holds.
      if (!finished) height.current = element.offsetHeight;
      animating.current = false;
      animation.cancel();
    };
  }, [ref, key]);
}

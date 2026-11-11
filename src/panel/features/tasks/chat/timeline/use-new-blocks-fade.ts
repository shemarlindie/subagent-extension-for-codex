import { type RefObject, useLayoutEffect, useRef } from "react";

import {
  canAnimate,
  MOTION,
} from "../../../../shared/components/motion/motion-utils";

/**
 * Fades in the Markdown blocks a message gains when `key` changes, such as a
 * streamed paragraph or the rest of a reply once it is stored. A new message's
 * first blocks don't fade here, since Chat fades the whole row in.
 */
export function useNewBlocksFade(
  ref: RefObject<HTMLElement | null>,
  key: unknown,
) {
  const seen = useRef<WeakSet<Element>>(undefined);

  useLayoutEffect(() => {
    const body = ref.current?.querySelector(".markdown-body");
    if (!body) return;
    const first = !seen.current;
    seen.current ??= new WeakSet();
    const added = newBlocks(body, seen.current);
    if (first || !canAnimate(body)) return;

    for (const block of added) {
      block.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: MOTION.slow,
        easing: MOTION.easing,
      });
    }
  }, [ref, key]);
}

/** The outermost elements under `parent` not seen before, marking all seen. */
function newBlocks(parent: Element, seen: WeakSet<Element>): Element[] {
  return [...parent.children].flatMap((child) => {
    if (seen.has(child)) return newBlocks(child, seen);
    markSeen(child, seen);

    return [child];
  });
}

function markSeen(element: Element, seen: WeakSet<Element>) {
  seen.add(element);
  for (const child of element.children) markSeen(child, seen);
}

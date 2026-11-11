import { type RefObject, useLayoutEffect, useRef } from "react";

import {
  canAnimate,
  MOTION,
} from "../../../../shared/components/motion/motion-utils";

/**
 * Fades in the Markdown blocks a message gains when `key` changes, such as a
 * streamed paragraph or the rest of a reply once it is stored. A new message's
 * first blocks don't fade here, since Chat fades the whole row in. A block
 * that replaces one showing the same thing, such as when a stored reply
 * that streamed in parts renders whole, doesn't fade.
 */
export function useNewBlocksFade(
  ref: RefObject<HTMLElement | null>,
  key: unknown,
) {
  const seen = useRef<WeakSet<Element>>(undefined);
  const shown = useRef<Element[]>([]);

  useLayoutEffect(() => {
    const body = ref.current?.querySelector(".markdown-body");
    if (!body) return;
    const first = !seen.current;
    seen.current ??= new WeakSet();

    // Blocks that left since the last render, so one rendered again in their
    // place doesn't fade.
    const replaced = new Set(
      shown.current.filter((block) => !block.isConnected).map(blockKey),
    );

    const added = newBlocks(body, seen.current).filter(
      (block) => !replaced.has(blockKey(block)),
    );

    shown.current = [...body.children];
    if (first || !canAnimate(body)) return;

    for (const block of added) {
      block.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: MOTION.slow,
        easing: MOTION.easing,
      });
    }
  }, [ref, key]);
}

// Ids can change when a reply renders whole, such as a repeated heading's
// slug, so a block is compared by what it shows.
function blockKey(block: Element) {
  return `${block.tagName}\0${block.textContent}`;
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

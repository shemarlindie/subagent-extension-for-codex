import {
  type AutoAnimationPlugin,
  getTransitionSizes,
} from "@formkit/auto-animate";
import { useAutoAnimate } from "@formkit/auto-animate/react";

import { MOTION, reducedMotion } from "./motion-utils";

const timing = { duration: MOTION.base, easing: MOTION.easing };
const exitInert = new WeakMap<Element, boolean>();

type ListCoordinates = Parameters<typeof getTransitionSizes>[1];

/** Measurements include CSS zoom, while keyframe lengths use unzoomed units. */
function cssCoordinates(box: ListCoordinates, zoom: number): ListCoordinates {
  return {
    top: box.top / zoom,
    left: box.left / zoom,
    width: box.width / zoom,
    height: box.height / zoom,
  };
}

/**
 * AutoAnimate effects with the panel's tokens: rows fade in, fade out while
 * neighbours close the gap, and slide to new positions. A plugin turns off
 * AutoAnimate's own reduced-motion check, so this checks it on every change.
 * For "remain", AutoAnimate passes the old coordinates first, unlike its typings.
 */
export const autoListEffects: AutoAnimationPlugin = (
  el,
  action,
  previous,
  next,
) => {
  // AutoAnimate reinserts removed nodes for their exit. Keep those controls out
  // of the tab order and accessibility tree, restoring any reused node's state.
  if (action === "remove") {
    if (!exitInert.has(el)) exitInert.set(el, el.hasAttribute("inert"));
    el.setAttribute("inert", "");
  } else if (exitInert.has(el)) {
    el.toggleAttribute("inert", exitInert.get(el));
    exitInert.delete(el);
  }

  // An empty effect finishes at once, so a removed row is cleaned up immediately.
  if (reducedMotion(el)) return new KeyframeEffect(el, [], { duration: 0 });

  if (action === "add") {
    return new KeyframeEffect(
      el,
      [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1 }],
      timing,
    );
  }

  // A removed row sits absolutely positioned over the gap while it fades.
  if (action === "remove") {
    return new KeyframeEffect(el, [{ opacity: 1 }, { opacity: 0 }], {
      ...timing,
      duration: MOTION.fast,
    });
  }

  // AutoAnimate passes both coordinates for "remain".
  if (!previous || !next) return new KeyframeEffect(el, [], { duration: 0 });

  const zoom = el.currentCSSZoom || 1;
  const from = cssCoordinates(previous, zoom);
  const to = cssCoordinates(next, zoom);

  const [widthFrom, widthTo, heightFrom, heightTo] = getTransitionSizes(
    el,
    from,
    to,
  );

  // An edge that stays put anchors the box, as for a list pinned above the composer.
  const dx =
    from.left + from.width === to.left + to.width ? 0 : from.left - to.left;

  const dy =
    from.top + from.height === to.top + to.height ? 0 : from.top - to.top;

  const start: Keyframe = { transform: `translate(${dx}px, ${dy}px)` };
  const end: Keyframe = { transform: "none" };

  // The list itself eases its size, so content around it follows.
  if (widthFrom !== widthTo) {
    start.width = `${widthFrom}px`;
    end.width = `${widthTo}px`;
  }

  if (heightFrom !== heightTo) {
    start.height = `${heightFrom}px`;
    end.height = `${heightTo}px`;
  }

  return new KeyframeEffect(el, [start, end], timing);
};

/**
 * Animates a list's direct children as they arrive, leave and reorder. Attach
 * the returned ref to the list element; children must have boxes of their own
 * (no `display: contents` wrappers such as `Presence`).
 */
export function useAutoList<T extends Element>() {
  return useAutoAnimate<T>(autoListEffects);
}

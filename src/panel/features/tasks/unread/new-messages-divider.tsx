import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";

import {
  canAnimate,
  MOTION,
} from "../../../shared/components/motion/motion-utils";
import { scrollContainer } from "../../../shared/utils/scroll-container";
import { NEW_MESSAGES_ID } from "./new-messages";

type NewMessagesDividerProps = {
  /** Open the divider's space smoothly when it mounts. */
  animate?: boolean;
  /** A divider the marker moved away from: close its space, then call `onLeft`. */
  leaving?: boolean;
  onLeft?: () => void;
};

/** Collapsed, then full size. A negative margin cancels the row gap the divider adds. */
function frames(element: HTMLElement): Keyframe[] {
  const style = getComputedStyle(element);
  const gap = parseFloat(getComputedStyle(element.parentElement!).rowGap);

  return [
    {
      height: "0px",
      paddingTop: "0px",
      marginBottom: `${-(gap || 0)}px`,
      opacity: "0",
      overflow: "hidden",
    },
    {
      height: style.height,
      paddingTop: style.paddingTop,
      marginBottom: "0px",
      opacity: "1",
      overflow: "hidden",
    },
  ];
}

/**
 * Below the view, nobody sees the divider go; starting above it, even in
 * part, shrinking would pull the rows below up frame by frame.
 */
function collapsesAtOnce(element: HTMLElement) {
  const row = element.getBoundingClientRect();
  const frame = scrollContainer(element).getBoundingClientRect();

  return row.top < frame.top || row.top >= frame.bottom;
}

/** Marks where Chat's unread messages start when an unread task opens. */
export function NewMessagesDivider({
  animate,
  leaving,
  onLeft,
}: NewMessagesDividerProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Only a mount moves: a mark that leaves the divider in place, or repeats,
  // must not collapse it again.
  const [motion] = useState(() => {
    if (leaving) return "leave";

    return animate ? "grow" : undefined;
  });

  const left = useEffectEvent(() => onLeft?.());

  // Grow from nothing, or shrink to nothing, so the messages below ease
  // instead of jumping. The divider's top stays put, so a scroll to it lands
  // in the same place.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !motion) return;

    // Out of view, partly above it, or without motion, a leaving divider
    // collapses at once, during the render that moved it. Chat's reading
    // scroll corrects for that in the same frame. Unmounting afterwards moves
    // nothing.
    if (
      motion === "leave" &&
      (!canAnimate(element) || collapsesAtOnce(element))
    ) {
      Object.assign(element.style, frames(element)[0]);
      left();

      return;
    }

    if (!canAnimate(element)) return;
    const timing = { duration: MOTION.slow, easing: MOTION.easing };

    if (motion === "grow") {
      const animation = element.animate(frames(element), timing);

      return () => animation.cancel();
    }

    const animation = element.animate(frames(element).reverse(), {
      ...timing,
      fill: "forwards",
    });

    animation.onfinish = () => left();

    return () => animation.cancel();
  }, [motion]);

  // A leaving divider is no longer the marker, so Chat cannot scroll or
  // anchor to it, and assistive technology skips it.
  return (
    <div
      ref={ref}
      data-chat-item={leaving ? undefined : NEW_MESSAGES_ID}
      className="new-messages-divider"
      role={leaving ? undefined : "separator"}
      aria-label={leaving ? undefined : "New messages"}
      aria-hidden={leaving || undefined}
    >
      <span>New</span>
    </div>
  );
}

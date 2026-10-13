import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { canAnimate, MOTION } from "./motion-utils";

type Variant = "collapse" | "fold" | "pop";

// Collapse folds every box edge so neighbours slide rather than jump.
function frames(variant: Variant, element: HTMLElement): Keyframe[] {
  if (variant === "pop") {
    return [
      { opacity: 0, transform: "scale(0.85)" },
      { opacity: 1, transform: "none" },
    ];
  }

  // Fold shrinks an item in a flex row along its width; the negative margin cancels the row's gap.
  if (variant === "fold") {
    // The Presence wrapper has no box, so the row is the nearest ancestor that does.
    let row = element.parentElement;

    while (row && getComputedStyle(row).display === "contents") {
      row = row.parentElement;
    }

    const gap = parseFloat(getComputedStyle(row ?? element).columnGap);

    return [
      {
        opacity: 0,
        overflow: "hidden",
        width: "0px",
        paddingLeft: "0px",
        paddingRight: "0px",
        borderLeftWidth: "0px",
        borderRightWidth: "0px",
        marginLeft: `${-(gap || 0)}px`,
      },
      {
        opacity: 1,
        overflow: "hidden",
        width: `${element.offsetWidth}px`,
        ...Object.fromEntries(
          (
            [
              "paddingLeft",
              "paddingRight",
              "borderLeftWidth",
              "borderRightWidth",
              "marginLeft",
            ] as const
          ).map((edge) => [edge, getComputedStyle(element)[edge]]),
        ),
      },
    ];
  }

  const style = getComputedStyle(element);

  const edges = [
    "paddingTop",
    "paddingBottom",
    "marginTop",
    "marginBottom",
    "borderTopWidth",
    "borderBottomWidth",
  ] as const;

  return [
    {
      opacity: 0,
      overflow: "hidden",
      height: "0px",
      ...Object.fromEntries(edges.map((edge) => [edge, "0px"])),
    },
    {
      opacity: 1,
      overflow: "hidden",
      height: `${element.offsetHeight}px`,
      ...Object.fromEntries(edges.map((edge) => [edge, style[edge]])),
    },
  ];
}

interface PresenceProps {
  show: boolean;
  /** `li` wraps a list row, so the list keeps valid children. */
  as?: "div" | "span" | "li";
  variant?: Variant;
  /** False applies this change at once, for batches such as a first load that should not play. */
  animate?: boolean;
  /** Animates in on first render too, for an item arriving in a list that is already showing. */
  appear?: boolean;
  children?: ReactNode;
}

/**
 * Keeps its child mounted while it animates out, and animates it in when shown.
 * The child should be a single element; the wrapper itself has no box.
 * Content present on first render appears in place, since the view around it is new too.
 */
export function Presence({
  show,
  as = "div",
  variant = "collapse",
  animate = true,
  appear = false,
  children,
}: PresenceProps) {
  const wrapper = useRef<HTMLElement>(null);
  const Wrapper = as;
  const [previous, setPrevious] = useState(show);
  const [exiting, setExiting] = useState(false);

  if (previous !== show) {
    setPrevious(show);
    setExiting(!show);
  }

  // The exit animation shows the content that was last visible.
  const last = useRef(children);
  if (show) last.current = children;
  const first = useRef(!appear);

  useLayoutEffect(() => {
    const skip = first.current;
    first.current = false;
    const element = wrapper.current?.firstElementChild as HTMLElement | null;

    if (!animate || !canAnimate(element)) {
      if (!show) setExiting(false);

      return;
    }

    if (skip) return;
    const keyframes = frames(variant, element!);
    const timing = { duration: MOTION.base, easing: MOTION.easing };

    if (show) {
      const animation = element!.animate(keyframes, timing);

      return () => animation.cancel();
    }

    const animation = element!.animate(keyframes.reverse(), {
      ...timing,
      fill: "forwards",
    });

    animation.onfinish = () => setExiting(false);

    return () => animation.cancel();
  }, [show]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!show && !exiting) return null;

  return (
    <Wrapper
      ref={(element: HTMLElement | null) => {
        wrapper.current = element;
      }}
      className="presence"
      inert={!show}
    >
      {show ? children : last.current}
    </Wrapper>
  );
}

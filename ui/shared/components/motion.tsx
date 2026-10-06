import {
  type Key,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { canAnimate, MOTION } from "./motion-utils";

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

type Variant = "collapse" | "fold" | "pop";

// Collapse folds every box edge so neighbours slide rather than jump.
function frames(variant: Variant, element: HTMLElement): Keyframe[] {
  if (variant === "pop")
    return [
      { opacity: 0, transform: "scale(0.85)" },
      { opacity: 1, transform: "none" },
    ];

  // Fold shrinks an item in a flex row along its width; the negative margin cancels the row's gap.
  if (variant === "fold") {
    // The Presence wrapper has no box, so the row is the nearest ancestor that does.
    let row = element.parentElement;

    while (row && getComputedStyle(row).display === "contents")
      row = row.parentElement;
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
  variant?: Variant;
  /** False applies this change at once, for batches such as a first load that should not play. */
  animate?: boolean;
  children?: ReactNode;
}

/**
 * Keeps its child mounted while it animates out, and animates it in when shown.
 * The child should be a single element; the wrapper itself has no box.
 * Content present on first render appears in place, since the view around it is new too.
 */
export function Presence({
  show,
  variant = "collapse",
  animate = true,
  children,
}: PresenceProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  const [previous, setPrevious] = useState(show);
  const [exiting, setExiting] = useState(false);

  if (previous !== show) {
    setPrevious(show);
    setExiting(!show);
  }

  // The exit animation shows the content that was last visible.
  const last = useRef(children);
  if (show) last.current = children;
  const first = useRef(true);

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
    <div ref={wrapper} className="presence" inert={!show}>
      {show ? children : last.current}
    </div>
  );
}

/**
 * Slides keyed children (matched by `attribute`) from their previous position when
 * `key` changes, so rows that reorder or close a gap move instead of jumping.
 * Newly arrived rows are left to their own CSS entrance.
 */
export function useListMotion(
  ref: RefObject<HTMLElement | null>,
  attribute: string,
  key: unknown,
) {
  const tops = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;

    const previous = tops.current,
      next = new Map<string, number>(),
      animations: Animation[] = [];

    const motion = canAnimate(container),
      // Relative to the list, so layout shifts above it never read as row movement.
      origin = container.getBoundingClientRect().top - container.scrollTop;

    for (const element of container.querySelectorAll<HTMLElement>(
      `[${attribute}]`,
    )) {
      const id = element.getAttribute(attribute)!,
        top = element.getBoundingClientRect().top - origin;

      next.set(id, top);
      const old = previous.get(id);
      if (!motion || old === undefined || Math.abs(old - top) < 1) continue;

      animations.push(
        element.animate(
          [{ transform: `translateY(${old - top}px)` }, { transform: "none" }],
          { duration: MOTION.slow, easing: MOTION.easing },
        ),
      );
    }

    tops.current = next;

    return () => animations.forEach((animation) => animation.cancel());
  }, [ref, attribute, key]);
}

/**
 * Animates an element's height when `key` changes its size, so content that grows
 * or shrinks in place (a clamp opening, a dialog switching forms) eases instead of jumping.
 */
export function useAnimatedHeight(
  ref: RefObject<HTMLElement | null>,
  key: unknown,
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
    // A new element starts from its own height, never a predecessor's.
    height.current = element?.offsetHeight;
    if (!element) return;

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

    const from = height.current,
      to = element.offsetHeight;

    height.current = to;
    if (from === undefined || Math.abs(from - to) < 1 || !canAnimate(element))
      return;
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

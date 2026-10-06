import { type ReactNode, useEffect, useRef, useState } from "react";

/** How far outside the scroll area blocks mount, so scrolling finds them ready. */
const MARGIN = "1200px 0px";

/** The nearest ancestor that scrolls vertically; null means the viewport. */
export function scrollParent(element: HTMLElement) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }

  return null;
}

type LazyBlockProps = {
  /** Height in pixels before the block has been measured. */
  estimate: number;
  className?: string;
  children: ReactNode;
};

/**
 * A block of rows that mounts only near the visible part of its scroll area.
 * Away from it, the block is an empty box of its last measured height, so
 * long content keeps few rows in the DOM and the scroll position holds. With
 * no IntersectionObserver (as in tests), it always renders.
 */
export function LazyBlock({ estimate, className, children }: LazyBlockProps) {
  const ref = useRef<HTMLDivElement>(null),
    height = useRef(estimate),
    [visible, setVisible] = useState(
      typeof IntersectionObserver === "undefined",
    );

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Keep the rendered height for the empty box that replaces it.
        if (!entry.isIntersecting)
          height.current = entry.boundingClientRect.height || height.current;
        setVisible(entry.isIntersecting);
      },
      { root: scrollParent(element), rootMargin: MARGIN },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      data-lazy={visible ? undefined : "hidden"}
      style={visible ? undefined : { height: height.current }}
    >
      {visible && children}
    </div>
  );
}

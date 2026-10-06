import { type ReactNode, useEffect, useRef, useState } from "react";

/** How far outside the scroll area blocks mount, so scrolling finds them ready. */
const MARGIN = "1200px 0px";

/**
 * The nearest ancestor that scrolls vertically; null means the viewport. A
 * box that may scroll but has grown to fit its content, such as a table that
 * only scrolls sideways, is skipped.
 */
export function scrollParent(element: HTMLElement) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    )
      return node;
  }

  return null;
}

type LazyBlockProps = {
  /** Height in pixels before the block has been measured. */
  estimate: number;
  /** "tbody" for a block of table rows; hidden, it holds one empty row. */
  as?: "div" | "tbody";
  /**
   * Render before the first visibility report, for a view's first block:
   * opening animations can delay that report, leaving the view blank.
   */
  eager?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * A block of rows that mounts only near the visible part of its scroll area.
 * Away from it, the block is an empty box of its last measured height, so
 * long content keeps few rows in the DOM and the scroll position holds. With
 * no IntersectionObserver (as in tests), it always renders.
 */
export function LazyBlock({
  estimate,
  as = "div",
  eager = false,
  className,
  children,
}: LazyBlockProps) {
  const ref = useRef<HTMLElement>(null),
    height = useRef(estimate),
    [visible, setVisible] = useState(
      eager || typeof IntersectionObserver === "undefined",
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

  const hidden = visible ? undefined : "hidden";

  // A table body can't take a height, so a hidden one holds a row that does.
  return as === "tbody" ? (
    <tbody
      ref={ref as React.RefObject<HTMLTableSectionElement>}
      className={className}
      data-lazy={hidden}
    >
      {visible ? children : <tr style={{ height: height.current }} />}
    </tbody>
  ) : (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className={className}
      data-lazy={hidden}
      style={visible ? undefined : { height: height.current }}
    >
      {visible && children}
    </div>
  );
}

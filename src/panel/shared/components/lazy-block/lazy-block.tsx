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
    ) {
      return node;
    }
  }

  return null;
}

/**
 * Layout changes that can move which box scrolls (the evidence tab on wide
 * panels, the whole inspector on short ones): the window resizing, or a
 * watched scroll area changing size, as when the task header grows. Every
 * block is told, at most once a frame; one window listener and one
 * ResizeObserver serve them all.
 */
const resizeListeners = new Set<() => void>();
let resizeFrame = 0;

function onLayoutChange(listener: () => void) {
  if (!resizeListeners.size) {
    window.addEventListener("resize", notifyResize, { passive: true });
  }

  resizeListeners.add(listener);

  return () => {
    resizeListeners.delete(listener);
    if (resizeListeners.size) return;
    window.removeEventListener("resize", notifyResize);
    cancelAnimationFrame(resizeFrame);
  };
}

/** Scroll areas being watched, with how many blocks watch each. */
const watchedAreas = new Map<Element, number>();
let areaObserver: ResizeObserver | undefined;

/** Reports size changes of a block's scroll area; returns a stop function. */
function watchArea(area: Element | null) {
  if (!area || typeof ResizeObserver === "undefined") return () => {};
  areaObserver ??= new ResizeObserver(notifyResize);
  const count = watchedAreas.get(area) ?? 0;
  if (!count) areaObserver.observe(area);
  watchedAreas.set(area, count + 1);

  return () => {
    const left = (watchedAreas.get(area) ?? 1) - 1;
    if (left) return void watchedAreas.set(area, left);
    watchedAreas.delete(area);
    areaObserver?.unobserve(area);
  };
}

function notifyResize() {
  cancelAnimationFrame(resizeFrame);

  resizeFrame = requestAnimationFrame(() =>
    resizeListeners.forEach((listener) => listener()),
  );
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

    let root: HTMLElement | null,
      observer: IntersectionObserver | undefined,
      unwatch = () => {};

    // Visibility is measured against the scroll area found now; a block
    // watched against a box that no longer scrolls would count as always
    // visible, so a layout change finds the area again.
    const observe = () => {
      const next = scrollParent(element);
      if (observer && next === root) return;
      observer?.disconnect();
      unwatch();
      root = next;
      // With no scroll area, the window's resize event covers the viewport.
      unwatch = watchArea(root);

      observer = new IntersectionObserver(
        (entries) => {
          // One element is observed; its last entry is its current state.
          for (const entry of entries) {
            // Keep the rendered height for the empty box that replaces it.
            if (!entry.isIntersecting) {
              height.current =
                entry.boundingClientRect.height || height.current;
            }

            setVisible(entry.isIntersecting);
          }
        },
        { root, rootMargin: MARGIN },
      );

      observer.observe(element);
    };

    observe();
    const stop = onLayoutChange(observe);

    return () => {
      stop();
      unwatch();
      observer?.disconnect();
    };
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

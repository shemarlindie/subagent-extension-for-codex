import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

interface ScrollbarMetrics {
  height: number;
  maxScroll: number;
  top: number;
  value: number;
}

interface TaskListScrollbarProps {
  scrollerRef: RefObject<HTMLDivElement | null>;
}

const MIN_THUMB_HEIGHT = 24;

export function TaskListScrollbar({ scrollerRef }: TaskListScrollbarProps) {
  const [metrics, setMetrics] = useState<ScrollbarMetrics>({
    height: 0,
    maxScroll: 0,
    top: 0,
    value: 0,
  });

  const drag = useRef<{
    pointerId: number;
    startScrollTop: number;
    startY: number;
  } | null>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;

    if (!scroller) return;

    const update = () => {
      const viewport = scroller.clientHeight;
      const maxScroll = Math.max(0, scroller.scrollHeight - viewport);

      const height =
        maxScroll > 0
          ? Math.min(
              viewport,
              Math.max(
                MIN_THUMB_HEIGHT,
                (viewport * viewport) / scroller.scrollHeight,
              ),
            )
          : 0;

      const trackRange = Math.max(0, viewport - height);

      const value =
        maxScroll > 0 ? Math.round((scroller.scrollTop / maxScroll) * 100) : 0;

      setMetrics({
        height,
        maxScroll,
        top: maxScroll > 0 ? (scroller.scrollTop / maxScroll) * trackRange : 0,
        value,
      });
    };

    scroller.addEventListener("scroll", update, { passive: true });

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);

    resizeObserver?.observe(scroller);

    const observeRows = () => {
      for (const child of scroller.children) resizeObserver?.observe(child);
      update();
    };

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? undefined
        : new MutationObserver(observeRows);

    mutationObserver?.observe(scroller, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    observeRows();

    return () => {
      scroller.removeEventListener("scroll", update);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [scrollerRef]);

  const moveThumb = (event: PointerEvent<HTMLDivElement>) => {
    const currentDrag = drag.current;
    const scroller = scrollerRef.current;

    if (!currentDrag || currentDrag.pointerId !== event.pointerId || !scroller)
      return;

    const trackRange = Math.max(1, scroller.clientHeight - metrics.height);

    const scrollRange = Math.max(
      0,
      scroller.scrollHeight - scroller.clientHeight,
    );

    scroller.scrollTop =
      currentDrag.startScrollTop +
      ((event.clientY - currentDrag.startY) / trackRange) * scrollRange;
  };

  const startThumbDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    const scroller = scrollerRef.current;

    if (!scroller) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    drag.current = {
      pointerId: event.pointerId,
      startScrollTop: scroller.scrollTop,
      startY: event.clientY,
    };
  };

  const endThumbDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;

    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const cancelThumbDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;

    drag.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;

    if (!scroller) return;

    const page = Math.max(40, scroller.clientHeight);
    const amount = Math.max(40, Math.round(page * 0.1));
    let scrollTop: number | undefined;

    switch (event.key) {
      case "ArrowDown":
        scrollTop = scroller.scrollTop + amount;
        break;
      case "ArrowUp":
        scrollTop = scroller.scrollTop - amount;
        break;
      case "PageDown":
        scrollTop = scroller.scrollTop + page;
        break;
      case "PageUp":
        scrollTop = scroller.scrollTop - page;
        break;
      case "Home":
        scrollTop = 0;
        break;
      case "End":
        scrollTop = scroller.scrollHeight;
        break;
      default:
        return;
    }

    event.preventDefault();
    scroller.scrollTop = scrollTop;
  };

  if (metrics.maxScroll <= 0) return null;

  return (
    <div className="task-list-scrollbar" data-scrollbar-owner="task-list">
      <div
        aria-controls="task-list"
        aria-label="Task list scroll position"
        aria-orientation="vertical"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={metrics.value}
        className="task-list-scrollbar-thumb"
        onKeyDown={onKeyDown}
        onPointerDown={startThumbDrag}
        onPointerMove={moveThumb}
        onPointerUp={endThumbDrag}
        onPointerCancel={cancelThumbDrag}
        role="scrollbar"
        style={{
          height: metrics.height,
          transform: `translateY(${metrics.top}px)`,
        }}
        tabIndex={0}
      />
    </div>
  );
}

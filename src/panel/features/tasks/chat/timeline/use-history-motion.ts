import { useLayoutEffect, useRef } from "react";

/**
 * Lets messages that arrive after a task's Chat has shown ease in, and reports
 * every intermediate history height so the reading scroll can follow it.
 */
export function useHistoryMotion(
  taskId: string | undefined,
  loading: boolean,
  onContentChange: () => void,
) {
  const shownTask = useRef<string | undefined>(undefined);
  const historyRef = useRef<HTMLDivElement>(null);
  const animateArrivals = !loading && shownTask.current === taskId;

  useLayoutEffect(() => {
    if (!loading) shownTask.current = taskId;
  }, [loading, taskId]);

  useLayoutEffect(() => {
    const history = historyRef.current;
    if (!history || typeof ResizeObserver === "undefined") return;

    // One observer follows every message's intermediate height, without
    // remeasuring the whole conversation once for each row that resized.
    const observer = new ResizeObserver(onContentChange);
    observer.observe(history);

    return () => observer.disconnect();
  }, [onContentChange, taskId]);

  return { historyRef, animateArrivals };
}

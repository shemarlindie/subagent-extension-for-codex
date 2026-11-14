import { useCallback, useLayoutEffect, useRef, useState } from "react";

import type { QueuedMessage } from "../../../../../shared/tasks/model";
import { useAutoList } from "../../../../shared/components/motion/auto-list";

/** A message queued out of view. `id` replays its cue for each one. */
export type QueueArrival = { id: number; queued: number };

/**
 * Scrolls the queue, and nothing around it, until `row` clears its faded
 * edges. Offsets ignore the transforms of rows still sliding into place.
 */
function reveal(list: HTMLElement, row: HTMLElement) {
  // `chat.css` sets the width of the faded edges.
  const fade = parseFloat(
    getComputedStyle(list).getPropertyValue("--chat-queue-fade"),
  );

  const top = row.offsetTop - fade;
  const bottom = row.offsetTop + row.offsetHeight + fade;

  if (top < list.scrollTop) {
    list.scrollTop = top;
  } else if (bottom > list.scrollTop + list.clientHeight) {
    list.scrollTop = bottom - list.clientHeight;
  }
}

/**
 * Whether the row for `id` ends below the visible part of the queue. Offsets
 * are rounded, so a pixel of overlap still counts as visible.
 */
function below(list: HTMLElement, id: string) {
  const row = list.querySelector<HTMLElement>(
    `[data-message="${CSS.escape(id)}"]`,
  );

  return (
    !!row &&
    row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight + 1
  );
}

/**
 * The queue list's scrolling. A row moved with the keyboard stays in view,
 * and `arrival` reports the latest message queued out of view.
 */
export function useQueueScroll(queue: readonly QueuedMessage[]) {
  const [animate] = useAutoList<HTMLUListElement>();
  const list = useRef<HTMLUListElement | null>(null);
  const known = useRef(new Set(queue.map((message) => message.id)));
  const [arrival, setArrival] = useState<QueueArrival>();
  const order = queue.map((message) => message.id).join();

  const ref = useCallback(
    (element: HTMLUListElement | null) => {
      animate(element);
      list.current = element;
    },
    [animate],
  );

  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const ids = order ? order.split(",") : [];
    const added = ids.filter((id) => !known.current.has(id));
    known.current = new Set(ids);

    const focused =
      document.activeElement?.closest<HTMLElement>(".chat-queue-item");

    if (focused && element.contains(focused)) reveal(element, focused);

    if (added.some((id) => below(element, id))) {
      setArrival((last) => ({ id: (last?.id ?? 0) + 1, queued: ids.length }));
    }
  }, [order]);

  return { ref, arrival };
}

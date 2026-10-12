import { useEffect, useRef } from "react";

import { scrollChildIntoView } from "../../utils/scroll-into-view";

const TAB_EDGE_GAP = 12;

interface ActiveTabInViewOptions<T extends string> {
  getTabId?: (value: T) => string;
  layoutKey?: string;
  edgeGap?: number;
}

/** Scrolls only an overflowing tab list to reveal its selected tab. */
export function useActiveTabInView<T extends string>(
  value: T,
  {
    getTabId = (tab) => `tab-${tab}`,
    layoutKey,
    edgeGap = TAB_EDGE_GAP,
  }: ActiveTabInViewOptions<T> = {},
) {
  const listRef = useRef<HTMLDivElement>(null),
    activeTabId = getTabId(value);

  useEffect(() => {
    const list = listRef.current,
      active = Array.from(
        list?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [],
      ).find((tab) => tab.id === activeTabId);

    if (list && active) scrollChildIntoView(list, active, edgeGap);
  }, [activeTabId, edgeGap, layoutKey]);

  return listRef;
}

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { createContext, useContext } from "react";

export type TimelineStatus = "running" | "completed" | "failed" | "info";

type TimelineState = { trimmed: boolean };

type TimelineItemState = {
  status: TimelineStatus;
  first: boolean;
  last: boolean;
};

// Lets a dot match its item's status without repeating the prop.
const ItemStatus = createContext<TimelineStatus>("info");

type TimelineProps = useRender.ComponentProps<"div", TimelineState> & {
  /** Older items were dropped, so the rail fades out past the last marker. */
  trimmed?: boolean;
};

/**
 * A vertical rail that runs between the first and last item markers.
 * State becomes data attributes (`data-trimmed`, `data-first`, `data-status`) for styling.
 */
export function Timeline({
  render,
  ref,
  trimmed = false,
  ...props
}: TimelineProps) {
  return useRender({
    render,
    ref,
    state: { trimmed },
    props: mergeProps<"div">({ className: "timeline" }, props),
  });
}

/** One entry; `first` and `last` stop the rail at this item's marker. */
export function TimelineItem({
  render,
  ref,
  status = "info",
  first = false,
  last = false,
  ...props
}: useRender.ComponentProps<"div", TimelineItemState> &
  Partial<TimelineItemState>) {
  const element = useRender({
    render,
    ref,
    state: { status, first, last },
    props: mergeProps<"div">({ className: "timeline-item" }, props),
  });

  return <ItemStatus.Provider value={status}>{element}</ItemStatus.Provider>;
}

/** The item's marker; place it at the start of the item's first line. */
export function TimelineDot({
  render,
  ref,
  ...props
}: useRender.ComponentProps<"span", { status: TimelineStatus }>) {
  return useRender({
    render,
    ref,
    defaultTagName: "span",
    state: { status: useContext(ItemStatus) },
    props: mergeProps<"span">(
      { className: "timeline-dot", "aria-hidden": true },
      props,
    ),
  });
}

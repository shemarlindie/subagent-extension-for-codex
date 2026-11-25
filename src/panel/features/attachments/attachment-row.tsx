import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type Key,
  type ReactNode,
} from "react";

import { useAnimatedHeight } from "../../shared/components/motion/use-animated-height";
import {
  fitAttachments,
  moreLabel,
  type AttachmentFit,
} from "./attachment-fit";

/** Reads the hidden copies' widths and fits the row to its current width. */
function useAttachmentFit(layoutKey: string, count: number) {
  const row = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<AttachmentFit>({ shown: count });

  useLayoutEffect(() => {
    const rowElement = row.current;
    const copies = measure.current;

    if (!rowElement || !copies) return;

    const width = (selector: string) =>
      copies.querySelector(selector)?.getBoundingClientRect().width ?? 0;

    const update = () =>
      setFit(
        fitAttachments({
          available: rowElement.clientWidth,
          gap: parseFloat(getComputedStyle(rowElement).columnGap) || 0,
          chips: [...copies.querySelectorAll("[data-chip]")].map(
            (chip) => chip.getBoundingClientRect().width,
          ),
          label: (hidden) => width(`[data-label="${hidden}"]`),
        }),
      );

    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(rowElement);

    return () => observer.disconnect();
  }, [layoutKey]);

  return { row, measure, fit };
}

type AttachmentRowProps<T> = {
  items: readonly T[];
  keyOf: (item: T) => Key;
  /** An item's chip. A narrow row truncates the first chip to `maxWidth`. */
  chip: (item: T, maxWidth?: number) => ReactNode;
  /** The chip without interactive parts, measured to decide what fits. */
  copy: (item: T) => ReactNode;
  /** Changes when a chip's width can, such as when a file finishes loading. */
  layoutKey?: string;
  className?: string;
};

/**
 * Attachment chips in one row. Chips that don't fit hide behind "+N more",
 * which expands the row in place.
 */
export function AttachmentRow<T>({
  items,
  keyOf,
  chip,
  copy,
  layoutKey = "",
  className,
}: AttachmentRowProps<T>) {
  const count = items.length;
  const keys = items.map(keyOf).join(" ");
  const { row, measure, fit } = useAttachmentFit(`${keys}|${layoutKey}`, count);
  const [expanded, setExpanded] = useState(false);
  const hidden = count - fit.shown;
  const shown = expanded ? items : items.slice(0, fit.shown);

  useAnimatedHeight(row, expanded);

  // Every hidden-count label, so the fit uses the one it would show.
  const counts = Array.from({ length: count - 1 }, (_, index) => index + 1);

  return (
    <div
      className={["attachment-row", className].filter(Boolean).join(" ")}
      data-expanded={expanded || undefined}
    >
      <div
        ref={row}
        className="attachment-row-items"
        role="group"
        aria-label="Attachments"
      >
        {shown.map((item, index) => (
          <Fragment key={keyOf(item)}>
            {chip(item, !expanded && index === 0 ? fit.firstMax : undefined)}
          </Fragment>
        ))}
        {(expanded || hidden > 0) && (
          // One element in both states, so it keeps focus as the row changes.
          <button
            key="toggle"
            type="button"
            className="attachment-row-toggle"
            aria-expanded={expanded}
            aria-label={
              expanded
                ? "Show fewer attachments"
                : `Show ${hidden} more ${hidden === 1 ? "attachment" : "attachments"}`
            }
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Show less" : moreLabel(hidden)}
          </button>
        )}
      </div>
      <div className="attachment-row-measure" aria-hidden="true" inert>
        <div ref={measure}>
          {items.map((item) => (
            <div key={keyOf(item)} data-chip>
              {copy(item)}
            </div>
          ))}
          {counts.map((hiddenCount) => (
            <span
              key={hiddenCount}
              className="attachment-row-toggle"
              data-label={hiddenCount}
            >
              {moreLabel(hiddenCount)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

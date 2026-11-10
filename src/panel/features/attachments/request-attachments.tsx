import { useLayoutEffect, useRef, useState } from "react";

import type { RequestAttachment } from "../../../shared/attachments/model.js";
import { useController } from "../../app/state/controller-context";
import type { Task } from "../tasks/types";
import { AttachmentChip, AttachmentChipContent } from "./attachment-chip";
import {
  type AttachmentFit,
  fitAttachments,
  moreLabel,
} from "./attachment-fit";

type RequestAttachmentsProps = {
  task: Task;
  attachments: RequestAttachment[];
};

/** Reads the hidden copies' widths and fits the row to its current width. */
function useAttachmentFit(count: number) {
  const row = useRef<HTMLDivElement>(null),
    measure = useRef<HTMLDivElement>(null),
    [fit, setFit] = useState<AttachmentFit>({ shown: count });

  useLayoutEffect(() => {
    const rowElement = row.current,
      copies = measure.current;

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
  }, [count]);

  return { row, measure, fit };
}

/**
 * The request's attachments in one right-aligned row. Chips that don't fit
 * hide behind "+N more", which expands the row in place.
 */
export function RequestAttachments({
  task,
  attachments,
}: RequestAttachmentsProps) {
  const controller = useController(),
    count = attachments.length,
    { row, measure, fit } = useAttachmentFit(count),
    [expanded, setExpanded] = useState(false),
    hidden = count - fit.shown,
    shown = expanded ? attachments : attachments.slice(0, fit.shown),
    // Every hidden-count label, so the fit uses the one it would show.
    counts = Array.from({ length: count - 1 }, (_, index) => index + 1);

  return (
    <div className="request-attachments" data-expanded={expanded || undefined}>
      <div
        ref={row}
        className="request-attachments-row"
        role="group"
        aria-label="Attachments"
      >
        {shown.map((attachment, index) => (
          <AttachmentChip
            key={attachment.position}
            attachment={attachment}
            maxWidth={!expanded && index === 0 ? fit.firstMax : undefined}
            onOpen={() =>
              controller.open({
                kind: "attachment",
                task,
                attachment,
                attachments,
              })
            }
          />
        ))}
        {(expanded || hidden > 0) && (
          // One element in both states, so it keeps focus as the row changes.
          <button
            key="toggle"
            type="button"
            className="request-attachments-toggle"
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
      <div className="request-attachments-measure" aria-hidden="true" inert>
        <div ref={measure}>
          {attachments.map((attachment) => (
            <span
              key={attachment.position}
              className="attachment-chip"
              data-chip
            >
              <AttachmentChipContent attachment={attachment} />
            </span>
          ))}
          {counts.map((hiddenCount) => (
            <span
              key={hiddenCount}
              className="request-attachments-toggle"
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

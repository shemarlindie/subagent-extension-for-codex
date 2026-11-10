import { type CSSProperties, useRef, useState } from "react";

import type { RequestAttachment } from "../../../shared/attachments/model.js";
import { Icon } from "../../shared/components/icons/icons";
import { TooltipWrapper } from "../../shared/components/tooltip";
import {
  attachmentIcon,
  attachmentRange,
  attachmentSize,
  chipTitle,
} from "./attachment-display";

/** Characters a long title keeps visible at its end, such as its extension. */
const TITLE_END = 12;

type AttachmentChipContentProps = { attachment: RequestAttachment };

/** A chip's icon, title and size, shared by the chip and its measured copy. */
export function AttachmentChipContent({
  attachment,
}: AttachmentChipContentProps) {
  const title = chipTitle(attachment),
    // A long title truncates in the middle, so its extension stays visible.
    split = title.length > TITLE_END * 2;

  return (
    <>
      <Icon name={attachmentIcon(attachment)} size={11} />
      <span className="attachment-chip-title" data-split={split || undefined}>
        {split ? (
          <>
            <span className="attachment-chip-title-start">
              {title.slice(0, -TITLE_END)}
            </span>
            <span>{title.slice(-TITLE_END)}</span>
          </>
        ) : (
          title
        )}
      </span>
      <span className="attachment-chip-size">
        {attachment.source === "diff" ? (
          <>
            <span className="attachment-added">+{attachment.additions}</span>{" "}
            <span className="attachment-removed">−{attachment.deletions}</span>
          </>
        ) : (
          (attachmentRange(attachment) ?? attachmentSize(attachment))
        )}
      </span>
    </>
  );
}

type AttachmentChipProps = {
  attachment: RequestAttachment;
  /** A narrow row truncates the first chip's title to this width. */
  maxWidth?: number;
  onOpen: () => void;
};

/** Whether the title, or a split title's start, is cut off. */
function titleTruncated(chip: HTMLElement | null) {
  const title = chip?.querySelector<HTMLElement>(".attachment-chip-title");

  return [title, ...(title?.children ?? [])].some(
    (part) => part && part.scrollWidth > part.clientWidth,
  );
}

/**
 * One attachment under the request. Its summary shows as a tooltip, after the
 * full title when the chip cuts it off.
 */
export function AttachmentChip({
  attachment,
  maxWidth,
  onOpen,
}: AttachmentChipProps) {
  const chip = useRef<HTMLButtonElement>(null),
    [open, setOpen] = useState(false),
    [truncated, setTruncated] = useState(false),
    style: CSSProperties | undefined =
      maxWidth === undefined ? undefined : { maxWidth };

  const handleOpenChange = (next: boolean) => {
    if (next) setTruncated(titleTruncated(chip.current));
    setOpen(next);
  };

  return (
    <TooltipWrapper
      label={attachment.summary}
      content={
        truncated ? (
          <>
            <span className="attachment-chip-tooltip-title">
              {attachment.title}
            </span>
            {attachment.summary}
          </>
        ) : undefined
      }
      triggerLabel={`${attachment.title}, ${attachmentSize(attachment)}. ${attachment.summary}`}
      open={open}
      onOpenChange={handleOpenChange}
    >
      <button
        ref={chip}
        type="button"
        className="attachment-chip"
        style={style}
        onClick={onOpen}
      >
        <AttachmentChipContent attachment={attachment} />
      </button>
    </TooltipWrapper>
  );
}

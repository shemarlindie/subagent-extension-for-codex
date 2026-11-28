import { useRef, useState, type CSSProperties } from "react";

import type { MessageAttachment } from "../../../core/shared/attachments/model.js";
import { Icon } from "../../shared/components/icons/icons";
import { TooltipWrapper } from "../../shared/components/tooltip";
import { useSingleFlight } from "../../shared/utils/use-single-flight";
import {
  attachmentIcon,
  attachmentRange,
  attachmentSize,
  displayTitle,
} from "./attachment-display";

/** Characters a long title keeps visible at its end, such as its extension. */
const TITLE_END = 12;

type AttachmentChipTitleProps = { title: string };

/** A chip's title. A long one truncates in the middle, so its extension stays visible. */
export function AttachmentChipTitle({ title }: AttachmentChipTitleProps) {
  const split = title.length > TITLE_END * 2;

  return (
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
  );
}

type AttachmentChipContentProps = { attachment: MessageAttachment };

/** A chip's icon, title and size, shared by the chip and its measured copy. */
export function AttachmentChipContent({
  attachment,
}: AttachmentChipContentProps) {
  return (
    <>
      <Icon name={attachmentIcon(attachment)} size={11} />
      <AttachmentChipTitle title={displayTitle(attachment)} />
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

/** Whether the title, or a split title's start, is cut off. */
export function titleTruncated(chip: HTMLElement | null) {
  const title = chip?.querySelector<HTMLElement>(".attachment-chip-title");

  return [title, ...(title?.children ?? [])].some(
    (part) => part && part.scrollWidth > part.clientWidth,
  );
}

type AttachmentChipProps = {
  attachment: MessageAttachment;
  /** A narrow row truncates the first chip's title to this width. */
  maxWidth?: number;
  onOpen: () => Promise<void>;
};

/**
 * One attachment under the request. Its summary shows as a tooltip, after the
 * full title when the chip cuts it off.
 */
export function AttachmentChip({
  attachment,
  maxWidth,
  onOpen,
}: AttachmentChipProps) {
  const chip = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [opening, run] = useSingleFlight();

  const style: CSSProperties | undefined =
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
        aria-busy={opening || undefined}
        onClick={() => run(onOpen)}
      >
        <AttachmentChipContent attachment={attachment} />
      </button>
    </TooltipWrapper>
  );
}

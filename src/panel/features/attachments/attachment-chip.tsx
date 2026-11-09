import type { CSSProperties } from "react";

import type { RequestAttachment } from "../../../shared/attachments/model.js";
import { Icon } from "../../shared/components/icons/icons";
import { TooltipWrapper } from "../../shared/components/tooltip";
import { attachmentIcon, attachmentSize } from "./attachment-display";

type AttachmentChipContentProps = { attachment: RequestAttachment };

/** A chip's icon, title and size, shared by the chip and its measured copy. */
export function AttachmentChipContent({
  attachment,
}: AttachmentChipContentProps) {
  return (
    <>
      <Icon name={attachmentIcon(attachment)} size={14} />
      <span className="attachment-chip-title">{attachment.title}</span>
      <span className="attachment-chip-size">
        {attachment.source === "diff" ? (
          <>
            <span className="attachment-added">+{attachment.additions}</span>{" "}
            <span className="attachment-removed">−{attachment.deletions}</span>
          </>
        ) : (
          attachmentSize(attachment)
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

/** One attachment under the request. Its summary shows as a tooltip. */
export function AttachmentChip({
  attachment,
  maxWidth,
  onOpen,
}: AttachmentChipProps) {
  const style: CSSProperties | undefined =
    maxWidth === undefined ? undefined : { maxWidth };

  return (
    <TooltipWrapper
      label={attachment.summary}
      triggerLabel={`${attachment.title}, ${attachmentSize(attachment)}. ${attachment.summary}`}
    >
      <button
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

import type { MessageAttachment } from "../../../shared/attachments/model.js";
import { AttachmentChip, AttachmentChipContent } from "./attachment-chip";
import { AttachmentRow } from "./attachment-row";
import { useOpenAttachment } from "./use-open-attachment";

type MessageAttachmentsProps = {
  taskId: string;
  attachments: MessageAttachment[];
};

/**
 * A message's attachments in one right-aligned row. Selecting one opens its
 * stored file in the host's viewer, or else the panel's preview.
 */
export function MessageAttachments({
  taskId,
  attachments,
}: MessageAttachmentsProps) {
  const open = useOpenAttachment(taskId, attachments);

  return (
    <AttachmentRow
      className="message-attachments"
      items={attachments}
      keyOf={(attachment) => attachment.position}
      chip={(attachment, maxWidth) => (
        <AttachmentChip
          attachment={attachment}
          maxWidth={maxWidth}
          onOpen={() => open(attachment)}
        />
      )}
      copy={(attachment) => (
        <span className="attachment-chip">
          <AttachmentChipContent attachment={attachment} />
        </span>
      )}
    />
  );
}

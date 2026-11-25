import type { MessageAttachment } from "../../../shared/attachments/model.js";
import { useController } from "../../app/state/controller-context";
import { findTask } from "../../app/state/selectors";
import { AttachmentChip, AttachmentChipContent } from "./attachment-chip";
import { AttachmentRow } from "./attachment-row";

type MessageAttachmentsProps = {
  taskId: string;
  attachments: MessageAttachment[];
};

/** A message's attachments in one right-aligned row. */
export function MessageAttachments({
  taskId,
  attachments,
}: MessageAttachmentsProps) {
  const controller = useController();

  const open = (attachment: MessageAttachment) => {
    const task = findTask(controller.getSnapshot(), taskId);

    if (task) {
      controller.open({ kind: "attachment", task, attachment, attachments });
    }
  };

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

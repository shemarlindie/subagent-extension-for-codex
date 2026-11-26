import type { MessageAttachment } from "../../../shared/attachments/model.js";
import { useController } from "../../app/state/controller-context";
import { findTask } from "../../app/state/selectors";
import { AttachmentChip, AttachmentChipContent } from "./attachment-chip";
import { AttachmentRow } from "./attachment-row";

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
  const controller = useController();

  const open = async (attachment: MessageAttachment) => {
    const state = controller.getSnapshot();
    const { transport } = controller;

    if (state.host.canOpenFiles && transport.openFile) {
      const { path } = await controller.tool<{ path: string }>(
        "app_get_attachment_path",
        {
          task_id: taskId,
          message_id: attachment.message_id,
          position: attachment.position,
        },
      );

      await transport.openFile(path);

      return;
    }

    const task = findTask(state, taskId);

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
          onOpen={() => controller.run(() => open(attachment))}
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

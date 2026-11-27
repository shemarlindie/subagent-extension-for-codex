import type { MessageAttachment } from "../../../shared/attachments/model.js";
import { useController } from "../../app/state/controller-context";
import { findTask } from "../../app/state/selectors";
import { errorMessage } from "../../shared/utils/error-message";

/**
 * Opens one of a message's attachments: its stored file in the host's viewer,
 * or else the panel's preview, which steps through `attachments`. A failure
 * is reported as a failed action.
 */
export function useOpenAttachment(
  taskId: string,
  attachments: MessageAttachment[],
) {
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

  return (attachment: MessageAttachment) =>
    open(attachment).catch((error: unknown) =>
      controller.reportActionFailure(errorMessage(error)),
    );
}

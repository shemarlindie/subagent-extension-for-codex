import type { ConversationMessage } from "../../../../../shared/tasks/conversation/messages.js";
import {
  useController,
  useSnapshot,
} from "../../../../app/state/controller-context";
import { findTask } from "../../../../app/state/selectors";
import { Button } from "../../../../shared/components/button/button";

type AskReplyButtonProps = {
  taskId: string;
  message: ConversationMessage;
  inline?: boolean;
};

/** Prepares a message about this reply for the user to review and send. */
export function AskReplyButton({
  taskId,
  message,
  inline,
}: AskReplyButtonProps) {
  const controller = useController();
  const threadMode = useSnapshot((state) => Boolean(state.conversation));

  if (!threadMode) return null;

  const ask = () => {
    const task = findTask(controller.getSnapshot(), taskId);

    if (task) {
      controller.prepareHandoff(
        task,
        { kind: "reply", id: message.id },
        message.text,
      );
    }
  };

  return (
    <>
      <Button variant="text" underline className="chat-handoff" onClick={ask}>
        Ask Codex about this reply
      </Button>
      {inline && <span aria-hidden="true">·</span>}
    </>
  );
}

import type { ConversationMessage } from "../../../../../shared/tasks/conversation/messages.js";
import {
  useController,
  useSnapshot,
} from "../../../../app/state/controller-context";
import type { Task } from "../../../../app/state/types";
import { Button } from "../../../../shared/components/button/button";

type AskReplyButtonProps = {
  task: Task;
  message: ConversationMessage;
};

/** Prepares a message about this reply for the user to review and send. */
export function AskReplyButton({ task, message }: AskReplyButtonProps) {
  const controller = useController();
  const threadMode = Boolean(useSnapshot().conversation);

  if (!threadMode) return null;

  return (
    <Button
      variant="text"
      underline
      className="chat-handoff"
      onClick={() =>
        controller.prepareHandoff(
          task,
          { kind: "reply", id: message.id },
          message.text,
        )
      }
    >
      Ask Codex about this reply
    </Button>
  );
}

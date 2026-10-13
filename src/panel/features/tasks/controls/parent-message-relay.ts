import type {
  ConversationMessage,
  ParentMessageNotification,
} from "../../../../shared/tasks/conversation/messages";
import type { Transport } from "../../../transports/types";

/** Forwards one claimed message per refresh from a mounted, chat-scoped panel. */
export class ParentMessageRelay {
  private running = false;
  constructor(
    private transport: Transport,
    private currentConversation: () => string | undefined,
  ) {}

  async forward(conversation: string) {
    if (this.running || !this.transport.send) return;
    this.running = true;

    try {
      const message =
        await this.transport.tool<ParentMessageNotification | null>(
          "claim_user_agent_parent_message",
          { conversation_id: conversation },
        );

      if (!message) return;
      let error: string | undefined;
      let skipped: "acknowledged" | undefined;

      try {
        const assertCurrent = () => {
          if (
            this.currentConversation() !== conversation ||
            message.conversation_id !== conversation
          ) {
            throw new Error(
              "Panel parent conversation changed before delivery",
            );
          }
        };

        assertCurrent();

        // A parent may acknowledge through polling while the claim is in flight.
        const report = await this.transport.tool<{
          message: ConversationMessage;
        }>("get_agent_message", {
          task_id: message.task_id,
          message_id: message.message_id,
        });

        assertCurrent();
        if (report.message.acknowledged) skipped = "acknowledged";
        else await this.transport.send(message.text, { submit: true });
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
      }

      await this.transport.tool("record_user_agent_parent_delivery", {
        task_id: message.task_id,
        attempt_id: message.attempt_id,
        conversation_id: conversation,
        delivered: error === undefined && skipped === undefined,
        ...(skipped ? { skipped } : {}),
        ...(error ? { error: error.slice(0, 2000) } : {}),
      });

      if (error) throw new Error(error);
    } finally {
      this.running = false;
    }
  }
}

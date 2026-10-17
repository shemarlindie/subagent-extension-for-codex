import type {
  ConversationMessage,
  ParentMessageNotification,
} from "../../../../shared/tasks/conversation/messages";
import type { Transport } from "../../../transports/types";

/** Forwards claimed messages from a mounted, chat-scoped panel. */
export class ParentMessageRelay {
  private running = false;
  /** Whether a forward was asked for while one ran, so it claims again. */
  private again = false;
  constructor(
    private transport: Transport,
    private currentConversation: () => string | undefined,
  ) {}

  /** Forwards each queued message in turn, until none remains or one fails. */
  async forward(conversation: string) {
    // Transports implement send as a method, so it keeps its receiver.
    const send = this.transport.send?.bind(this.transport);
    if (!send) return;

    if (this.running) {
      this.again = true;

      return;
    }

    this.running = true;

    try {
      do {
        this.again = false;
        while (await this.forwardOne(conversation, send));
      } while (
        this.askedAgain() &&
        this.currentConversation() === conversation
      );
    } finally {
      this.running = false;
    }
  }

  // A call rather than a field read: TypeScript keeps the field's narrowing
  // across the awaits that can change it.
  private askedAgain() {
    return this.again;
  }

  /** Claims and delivers one message; returns whether there was one. */
  private async forwardOne(
    conversation: string,
    send: NonNullable<Transport["send"]>,
  ) {
    const message = await this.transport.tool<ParentMessageNotification | null>(
      "claim_user_agent_parent_message",
      { conversation_id: conversation },
    );

    if (!message) return false;
    let error: string | undefined;
    let skipped: "acknowledged" | undefined;

    try {
      const assertCurrent = () => {
        if (
          this.currentConversation() !== conversation ||
          message.conversation_id !== conversation
        ) {
          throw new Error("Panel parent conversation changed before delivery");
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
      else await send(message.text, { submit: true });
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

    return true;
  }
}

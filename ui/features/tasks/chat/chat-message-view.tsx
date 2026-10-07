import type { ConversationMessage } from "../../../../src/features/tasks/messages.js";
import { MarkdownView } from "../../file-preview/components/markdown-view";
import { ShareMessageButton } from "./share-message-button";

type ChatMessageViewProps = {
  message: ConversationMessage;
  /** The worker's name, such as Claude, for its messages. */
  worker: string;
};

/**
 * One message: the user's on the right, the parent agent's labelled, and
 * the worker's rendered as Markdown, with its replies standing out.
 */
export function ChatMessageView({ message, worker }: ChatMessageViewProps) {
  const sent = message.from !== "worker";

  return (
    <article
      className="chat-message"
      data-from={message.from}
      data-kind={message.kind}
      data-message={message.id}
      aria-label={
        message.from === "worker"
          ? worker
          : message.from === "parent"
            ? "Parent agent"
            : "You"
      }
    >
      {message.from === "parent" && (
        <div className="chat-sender">Parent agent</div>
      )}
      {sent ? (
        <p className="chat-bubble">{message.text}</p>
      ) : (
        <div className="chat-worker-text">
          <MarkdownView content={message.text} />
        </div>
      )}
      {message.kind === "reply" && <ShareMessageButton id={message.id} />}
    </article>
  );
}

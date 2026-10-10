import type { TurnOutcome } from "../../../../../shared/tasks/conversation/chat.js";
import type { ConversationMessage } from "../../../../../shared/tasks/conversation/messages.js";
import { MarkdownView } from "../../../file-preview/markdown/markdown-view";
import { ShareMessageButton } from "./share-message-button";
import { TurnOutcomeRow } from "./turn-outcome-row";

type ChatMessageViewProps = {
  message: ConversationMessage;
  /** The worker's name, such as Claude, for its messages. */
  worker: string;
  /** Still being written: it shows a caret until the stored message replaces it. */
  streaming?: boolean;
  outcome?: TurnOutcome;
};

/**
 * One message: the user's on the right as typed, the parent agent's labelled,
 * and the agents' rendered as Markdown, with the worker's replies standing out.
 */
export function ChatMessageView({
  message,
  worker,
  streaming,
  outcome,
}: ChatMessageViewProps) {
  return (
    <article
      className="chat-message"
      data-from={message.from}
      data-kind={message.kind}
      data-message={message.id}
      data-chat-item={message.id}
      data-streaming={streaming || undefined}
      aria-busy={streaming || undefined}
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
      {message.from === "user" ? (
        <p className="chat-bubble">{message.text}</p>
      ) : message.from === "parent" ? (
        // The parent agent writes Markdown briefs; what the user typed stays literal.
        <div className="chat-bubble">
          <MarkdownView content={message.text} />
        </div>
      ) : (
        <div className="chat-worker-text">
          <MarkdownView content={message.text} />
        </div>
      )}
      {message.kind === "reply" && <ShareMessageButton id={message.id} />}
      {outcome && <TurnOutcomeRow outcome={outcome} response={message.text} />}
    </article>
  );
}

import type { TurnOutcome } from "../../../../../shared/tasks/conversation/chat.js";
import type { ConversationMessage } from "../../../../../shared/tasks/conversation/messages.js";
import type { Task } from "../../../../app/state/types";
import { MarkdownView } from "../../../file-preview/markdown/markdown-view";
import { AskReplyButton } from "./ask-reply-button";
import { MarkUnreadButton } from "./mark-unread-button";
import { TurnOutcomeRow } from "./turn-outcome-row";

type ChatMessageViewProps = {
  task?: Task;
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
  task,
  message,
  worker,
  streaming,
  outcome,
}: ChatMessageViewProps) {
  const askButton =
    task && message.kind === "reply" && !streaming ? (
      <AskReplyButton task={task} message={message} inline={Boolean(outcome)} />
    ) : undefined;

  const markUnreadButton =
    task && outcome ? (
      <MarkUnreadButton task={task} eventId={message.event_id} />
    ) : undefined;

  return (
    <article
      className="chat-message"
      data-from={message.from}
      data-kind={message.kind}
      data-message={message.id}
      data-chat-item={message.id}
      data-streaming={streaming || undefined}
      aria-busy={streaming || undefined}
      aria-label={messageLabel(message, worker)}
    >
      {message.from === "parent" && (
        <div className="chat-sender">Parent agent</div>
      )}
      {messageBody(message)}
      {outcome ? (
        <TurnOutcomeRow
          outcome={outcome}
          response={message.text}
          action={askButton}
          markUnread={markUnreadButton}
        />
      ) : (
        askButton
      )}
    </article>
  );
}

function messageLabel(message: ConversationMessage, worker: string) {
  if (message.from === "worker") return worker;
  if (message.from === "parent") return "Parent agent";

  return "You";
}

function messageBody(message: ConversationMessage) {
  if (message.from === "user") {
    return <p className="chat-bubble">{message.text}</p>;
  }

  if (message.from === "parent") {
    // The parent agent writes Markdown briefs; what the user typed stays literal.
    return (
      <div className="chat-bubble">
        <MarkdownView content={message.text} />
      </div>
    );
  }

  return (
    <div className="chat-worker-text">
      <MarkdownView content={message.text} />
    </div>
  );
}

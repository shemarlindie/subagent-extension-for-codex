import { memo, useMemo, useRef, useState } from "react";

import type { TurnOutcome } from "../../../../../shared/tasks/conversation/chat.js";
import type { ConversationMessage } from "../../../../../shared/tasks/conversation/messages.js";
import { useAnimatedHeight } from "../../../../shared/components/motion/use-animated-height";
import { RequestAttachments } from "../../../attachments/request-attachments";
import { MarkdownView } from "../../../file-preview/markdown/markdown-view";
import { markdownParts } from "../drafts/complete-paragraphs";
import { AskReplyButton } from "./ask-reply-button";
import { ChatMessageActions } from "./chat-message-actions";
import { MarkUnreadButton } from "./mark-unread-button";
import { TurnOutcomeRow } from "./turn-outcome-row";
import { useNewBlocksFade } from "./use-new-blocks-fade";

type ChatMessageViewProps = {
  taskId?: string;
  message: ConversationMessage;
  /** The worker's name, such as Claude, for its messages. */
  worker: string;
  /** Still being written: it shows a caret until the stored message replaces it. */
  streaming?: boolean;
  /** Expands a new message into a conversation that is already showing. */
  arriving?: boolean;
  outcome?: TurnOutcome;
};

/**
 * One message: the user's on the right as typed, the parent agent's labelled,
 * and the agents' rendered as Markdown, with the worker's replies standing out.
 * It renders only when its own props change, so its task's id stands in for
 * the task.
 */
export const ChatMessageView = memo(function ChatMessageView({
  taskId,
  message,
  worker,
  streaming,
  arriving,
  outcome,
}: ChatMessageViewProps) {
  const ref = useRef<HTMLElement>(null);
  // A message that streams in keeps rendering in parts once stored, so each
  // finished paragraph parses once and the stored text only adds its last part.
  const [inParts] = useState(Boolean(streaming));

  const content = useMemo(
    () => (inParts ? markdownParts(message.text) : message.text),
    [inParts, message.text],
  );

  const contentKey = `${message.text}\0${streaming ?? false}\0${outcome?.id ?? ""}`;
  useAnimatedHeight(ref, contentKey, arriving);
  useNewBlocksFade(ref, contentKey);

  const askButton =
    taskId && message.kind === "reply" && !streaming ? (
      <AskReplyButton
        taskId={taskId}
        message={message}
        inline={Boolean(outcome)}
      />
    ) : undefined;

  const markUnreadButton =
    taskId && outcome ? (
      <MarkUnreadButton taskId={taskId} eventId={message.event_id} />
    ) : undefined;

  const showUserActions = Boolean(taskId) && message.from === "user";

  return (
    <article
      ref={ref}
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
      {messageBody(message, content)}
      {taskId && message.kind === "request" && message.attachments?.length ? (
        // Keyed by task, so another task's row fits and folds afresh.
        <RequestAttachments
          key={taskId}
          taskId={taskId}
          attachments={message.attachments}
        />
      ) : undefined}
      {showUserActions && (
        <div className="chat-message-actions">
          <ChatMessageActions
            timestamp={message.timestamp}
            text={message.text}
          />
        </div>
      )}
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
});

function messageLabel(message: ConversationMessage, worker: string) {
  if (message.from === "worker") return worker;
  if (message.from === "parent") return "Parent agent";

  return "You";
}

function messageBody(
  message: ConversationMessage,
  content: string | readonly string[],
) {
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
      <MarkdownView content={content} />
    </div>
  );
}

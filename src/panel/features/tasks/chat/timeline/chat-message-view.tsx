import { memo, useMemo, useRef, useState } from "react";

import type { TurnOutcome } from "../../../../../shared/tasks/conversation/chat.js";
import type { ConversationMessage } from "../../../../../shared/tasks/conversation/messages.js";
import { useAnimatedHeight } from "../../../../shared/components/motion/use-animated-height";
import { MessageAttachments } from "../../../attachments/message-attachments";
import { MarkdownView } from "../../../file-preview/markdown/markdown-view";
import { MessageText } from "../../shared/message-text";
import { markdownParts } from "../drafts/complete-paragraphs";
import { AskReplyButton } from "./ask-reply-button";
import { ChatMessageActions } from "./chat-message-actions";
import { MarkUnreadButton } from "./mark-unread-button";
import { TurnOutcomeRow } from "./turn-outcome-row";
import { useNewBlocksFade } from "./use-new-blocks-fade";
import { WrapUpBox } from "./wrap-up-box";

type ChatMessageViewProps = {
  taskId?: string;
  message: ConversationMessage;
  /** The worker's name, such as Claude, for its messages. */
  worker: string;
  /** Still being written, until the stored message replaces it. */
  streaming?: boolean;
  /** Expands a new message into a conversation that is already showing. */
  arriving?: boolean;
  outcome?: TurnOutcome;
  /** The reply's wrap-up still waits on the user, so its buttons show. */
  answerable?: boolean;
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
  answerable,
}: ChatMessageViewProps) {
  const ref = useRef<HTMLElement>(null);
  // A message that streams in keeps rendering in parts once stored, so each
  // finished paragraph parses once and the stored text only adds its last part.
  const [inParts] = useState(Boolean(streaming));

  const content = useMemo(
    () => (inParts ? markdownParts(message.text) : message.text),
    [inParts, message.text],
  );

  const contentKey = `${message.text}\0${streaming ?? false}\0${outcome?.id ?? ""}\0${answerable ?? false}`;
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
      {message.wrap_up && (
        <WrapUpBox taskId={taskId} message={message} answerable={answerable} />
      )}
      {taskId && message.attachments?.length ? (
        // Keyed by task, so another task's row fits and folds afresh.
        <MessageAttachments
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
  if (message.from !== "worker") {
    // The parent agent writes Markdown briefs; what the user typed stays literal.
    return (
      <MessageText
        className="chat-bubble"
        text={message.text}
        markdown={message.from === "parent"}
      />
    );
  }

  return (
    <div className="chat-worker-text">
      <MarkdownView content={content} />
    </div>
  );
}

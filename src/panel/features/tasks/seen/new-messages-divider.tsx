import { NEW_MESSAGES_ID } from "./new-messages";

/** Marks where Chat's unseen messages start when an unseen task opens. */
export function NewMessagesDivider() {
  return (
    <div
      data-chat-item={NEW_MESSAGES_ID}
      className="new-messages-divider"
      role="separator"
      aria-label="New messages"
    >
      <span>New</span>
    </div>
  );
}

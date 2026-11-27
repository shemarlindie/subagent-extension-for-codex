import type { MessageAttachment } from "../../../../shared/attachments/model.js";
import type { ChatItem } from "../../../../shared/tasks/conversation/chat.js";

/** The selected task's Chat as read so far. */
export type ChatState = {
  task: string;
  items: ChatItem[];
  /** The last event read; the next read asks only for what follows. */
  cursor: number;
};

/** A view's Chat after a cursor. */
export type ChatRead = { items: ChatItem[]; next_cursor: number };

/**
 * Adds a read to the Chat already shown. An item read again (a message the
 * turn's reply took over, or an outcome row given its error) replaces the
 * earlier one where it is; new items follow.
 */
export function mergeChat(
  previous: ChatState | undefined,
  task: string,
  read: ChatRead,
): ChatState {
  const items = previous?.task === task ? [...previous.items] : [];

  for (const item of read.items) {
    const index = items.findIndex((existing) => existing.id === item.id);
    if (index >= 0) items[index] = item;
    else items.push(item);
  }

  return { task, items, cursor: read.next_cursor };
}

/** A task's message attachments by message id, from its Chat as read so far. */
export function messageAttachments(chat: ChatState | undefined, task: string) {
  const attached = new Map<string, MessageAttachment[]>();
  if (chat?.task !== task) return attached;

  for (const item of chat.items) {
    if (item.kind === "message" && item.message.attachments?.length) {
      attached.set(item.message.id, item.message.attachments);
    }
  }

  return attached;
}

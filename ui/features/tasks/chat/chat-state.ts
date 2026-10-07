import type { ChatItem } from "../../../../src/features/tasks/chat.js";

/** The selected task's Chat as read so far. */
export type ChatState = {
  task: string;
  items: ChatItem[];
  /** The last event read; the next read asks only for what follows. */
  cursor: number;
};

/** A read of Chat after a cursor, from `get_user_agent_chat`. */
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

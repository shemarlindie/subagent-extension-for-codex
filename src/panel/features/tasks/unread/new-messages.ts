import type { ChatItem } from "../../../../shared/tasks/conversation/chat.js";
import { responseOutcome } from "../chat/chat-model";

/** The row id of Chat's "New" divider, which Chat opens at. */
export const NEW_MESSAGES_ID = "new-messages";

// Worker messages and replies, turn outcomes and failures; the user's and
// parent's own messages, and notes such as compaction, never are.
const fromTask = (item: ChatItem) =>
  item.kind === "outcome" ||
  (item.kind === "note" && item.note === "failure") ||
  (item.kind === "message" && item.message.from === "worker");

/**
 * Where Chat's "New" divider goes: before the first item from the task after
 * event `through`, the newest the user had read. An outcome shows with the
 * worker response before it, so the divider then goes above that response.
 */
export function newMessagesIndex(items: ChatItem[], through: number) {
  const index = items.findIndex(
    (item) => item.event_id > through && fromTask(item),
  );

  if (index < 0) return undefined;

  return index > 0 && responseOutcome(items[index - 1], items[index])
    ? index - 1
    : index;
}

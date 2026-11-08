import { chatItems } from "../../../../shared/tasks/conversation/chat.js";
import type { Task } from "../../../../shared/tasks/model.js";
import type { Store } from "../storage/store.js";

/**
 * A task's Chat after cursor `after`, as `app_get_chat` returns it. An item
 * read again replaces the earlier one with its id, and a cursor of 0 also
 * returns the request.
 */
export function chatRead(store: Store, task: Task, after: number) {
  const events = store.chatEvents(task.id, after);

  return {
    items: chatItems(task, events).filter(
      (item) => item.event_id > after || (after === 0 && item.event_id === 0),
    ),
    next_cursor: Math.max(after, events.at(-1)?.id ?? 0),
  };
}

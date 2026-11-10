import { chatItems } from "../../../../shared/tasks/conversation/chat.js";
import type { Task } from "../../../../shared/tasks/model.js";
import type { Attachments } from "../../attachments/attachments.js";
import type { Store } from "../storage/store.js";

/**
 * A task's Chat after cursor `after`, as a panel view returns it. An item
 * read again replaces the earlier one with its id, and a cursor of 0 also
 * returns the request with its attachments, which never change.
 */
export function chatRead(
  store: Store,
  attachments: Attachments,
  task: Task,
  after: number,
) {
  const events = store.chatEvents(task.id, after);

  const items = chatItems(task, events).filter(
    (item) => item.event_id > after || (after === 0 && item.event_id === 0),
  );

  const request = items[0];

  if (after === 0 && request?.kind === "message") {
    const attached = attachments.list(task.id).map(({ file: _, ...a }) => a);
    if (attached.length) request.message.attachments = attached;
  }

  return { items, next_cursor: Math.max(after, events.at(-1)?.id ?? 0) };
}

import { chatItems } from "../../../../shared/tasks/conversation/chat.js";
import type { Task } from "../../../../shared/tasks/model.js";
import type { Attachments } from "../../attachments/attachments.js";
import type { Store } from "../storage/store.js";

/**
 * A task's Chat after cursor `after`, as a panel view returns it. An item
 * read again replaces the earlier one with its id, so each sent message
 * carries its attachments, which never change, whenever it's read. A cursor
 * of 0 also returns the request with its attachments.
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

  const messages = items.flatMap((item) =>
    item.kind === "message" && item.message.from !== "worker"
      ? [item.message]
      : [],
  );

  // Pages of worker output alone skip the read.
  const attached = messages.length ? attachments.list(task.id) : [];

  for (const { file: _, ...a } of attached) {
    const message = messages.find((m) => m.id === a.message_id);
    if (message) message.attachments = [...(message.attachments ?? []), a];
  }

  return { items, next_cursor: Math.max(after, events.at(-1)?.id ?? 0) };
}

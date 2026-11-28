import {
  parentUpdate,
  type PendingTaskUpdates,
} from "../../../../core/shared/tasks/conversation/parent-updates.js";
import type { Task } from "../../../../core/shared/tasks/model.js";
import type { PendingUpdateStore } from "../storage/pending-update-store.js";
import type { Store } from "../storage/store.js";

/**
 * Worker updates pending for the parent agent in a conversation, grouped by
 * task. Tasks and their updates are newest first. `parentDecides` says
 * whether the parent may decide a task's permissions.
 */
export function pendingUpdates(
  store: Store,
  pending: PendingUpdateStore,
  parentDecides: (t: Task) => boolean,
  owner: string,
  conversation: string,
): PendingTaskUpdates[] {
  const byTask = new Map<string, PendingTaskUpdates>();
  const tasks = new Map<string, { t: Task; decides: boolean }>();

  // Newest first, so tasks enter the map in order of their newest update.
  for (const e of pending.pending(owner, conversation).reverse()) {
    let task = tasks.get(e.task_id);

    if (!task) {
      const t = store.get(e.task_id, owner);
      task = { t, decides: parentDecides(t) };
      tasks.set(t.id, task);
    }

    const { t, decides } = task;
    const update = parentUpdate(t, e, decides);
    if (!update) continue;

    const entry = byTask.get(t.id) ?? {
      task_id: t.id,
      title: t.title,
      updates: [],
    };

    entry.updates.push(update);
    byTask.set(t.id, entry);
  }

  return [...byTask.values()];
}

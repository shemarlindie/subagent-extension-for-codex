import {
  PARENT_UPDATE_EVENTS,
  parentUpdate,
  type PendingTaskUpdates,
} from "../../../src/shared/tasks/conversation/parent-updates";
import { previewArchivedAt } from "./archive-tools";
import { previewEvents, previewTasks } from "./fixtures";

/** Pending update tools the browser fixtures answer from in-memory seen state. */
export const PREVIEW_PENDING_TOOLS = [
  "app_list_pending_updates",
  "app_mark_updates_seen",
];

// Codex hasn't seen these tasks' updates, so the header count starts with
// replies, a failure, a budget stop and a waiting question, and one task has
// several updates to select partly. Marking the question seen shows the normal
// state, and marking the rest hides the count.
const INITIALLY_PENDING = new Set([
  "preview-audit",
  "preview-failed",
  "preview-question",
  "preview-budget",
  "preview-conversation",
]);

const seen = new Set(
  previewEvents
    .filter((event) => !INITIALLY_PENDING.has(event.task_id))
    .map((event) => event.id),
);

/** The service's grouping: tasks and updates newest first, archived left out. */
function pending(conversation: unknown): PendingTaskUpdates[] {
  const byTask = new Map<string, PendingTaskUpdates>();

  const updates = previewEvents
    .filter(
      (event) =>
        PARENT_UPDATE_EVENTS.includes(event.type) && !seen.has(event.id),
    )
    .sort((a, b) => b.id - a.id);

  for (const event of updates) {
    const task = previewTasks.find((item) => item.id === event.task_id);

    if (
      !task ||
      task.conversation_id !== conversation ||
      previewArchivedAt(task.id)
    ) {
      continue;
    }

    const update = parentUpdate(task, event, false);
    if (!update) continue;

    const entry = byTask.get(task.id) ?? {
      task_id: task.id,
      title: task.title,
      updates: [],
    };

    entry.updates.push(update);
    byTask.set(task.id, entry);
  }

  return [...byTask.values()];
}

export function previewPending(name: string, args: Record<string, unknown>) {
  if (name === "app_list_pending_updates") {
    return { tasks: pending(args.conversation_id) };
  }

  const ids = args.event_ids as number[];
  for (const id of ids) seen.add(id);

  return { event_ids: ids };
}

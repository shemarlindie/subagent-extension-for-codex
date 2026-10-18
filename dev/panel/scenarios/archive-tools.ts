import { archivable } from "../../../src/shared/tasks/archive";
import type { Task } from "../../../src/shared/tasks/model";

/** Archive tools the browser fixtures answer by archiving tasks in memory. */
export const PREVIEW_ARCHIVE_TOOLS = ["app_set_tasks_archived"];

// Fixture tasks start unarchived, so existing scenarios list them as before.
const archived = new Map<string, string>();

/** When a fixture task was archived, until the preview reloads. */
export const previewArchivedAt = (taskId: string) => archived.get(taskId);

/** Archives or unarchives fixture tasks with the service's rules. */
export function previewArchiveTool(
  tasks: Task[],
  args: Record<string, unknown>,
) {
  const listed = (args.task_ids as unknown[]).map((id) => {
    const task = tasks.find((item) => item.id === id);
    if (!task) throw new Error("Task not found");

    return task;
  });

  const archiving = !!args.archived;

  const skipped = archiving ? listed.filter((task) => !archivable(task)) : [];
  const changed = listed.filter((task) => !skipped.includes(task));
  const at = new Date().toISOString();

  for (const task of changed) {
    if (!archiving) archived.delete(task.id);
    else if (!archived.has(task.id)) archived.set(task.id, at);
  }

  return {
    task_ids: changed.map((task) => task.id),
    skipped: skipped.map((task) => task.id),
  };
}

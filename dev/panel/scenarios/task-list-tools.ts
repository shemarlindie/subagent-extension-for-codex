import type { Task } from "../../../src/shared/tasks/model";
import { previewArchivedAt } from "./archive-tools";

export const newestFirst = (tasks: Task[]) =>
  [...tasks].sort((a, b) => b.created_at.localeCompare(a.created_at));

const inScope = (
  task: Task,
  scope: { conversation_id?: unknown; repository?: unknown },
) =>
  (typeof scope.conversation_id !== "string" ||
    task.conversation_id === scope.conversation_id) &&
  (typeof scope.repository !== "string" ||
    task.repository === scope.repository);

/** Mirrors `app_list_tasks`' archive and include filters on top of the scope. */
export const listed = (task: Task, args: Record<string, unknown>) =>
  (Array.isArray(args.include) && args.include.includes(task.id)) ||
  (inScope(task, args) &&
    (args.archived === "include" ||
      (args.archived === "only") === Boolean(previewArchivedAt(task.id))));

type ListedTask = Pick<Task, "id" | "status" | "repository"> & {
  unread?: boolean;
};

/**
 * Mirrors `app_list_tasks`, which leaves out read completed tasks unless
 * asked, except included ones and the newest, and counts them by repository.
 */
export function lightList<T extends ListedTask>(
  tasks: T[],
  args: Record<string, unknown>,
) {
  if (args.include_read_completed) return { tasks };
  const include = Array.isArray(args.include) ? args.include : [];

  const keep = new Set([...include, tasks[0]?.id]);

  const counts: Record<string, number> = {};

  const listed = tasks.filter((task) => {
    if (keep.has(task.id) || task.status !== "completed" || task.unread) {
      return true;
    }

    counts[task.repository] = (counts[task.repository] ?? 0) + 1;

    return false;
  });

  return { tasks: listed, read_completed: counts };
}

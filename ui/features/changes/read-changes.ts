import type { Task } from "../tasks/types";
import type { Changes, ChangeScope, ChangesState } from "./types";

type ReadPage = (args: Record<string, unknown>) => Promise<Changes>;

/**
 * Reads every page of a task's changes and merges them: pages share the file
 * list and each carries the next whole files of the diff. Stops early, with
 * undefined, once `live` reports the read is no longer wanted.
 */
export async function readChanges(
  taskId: string,
  scope: ChangeScope,
  read: ReadPage,
  live: () => boolean,
) {
  let page = await read({ task_id: taskId, scope });
  let diff = page.diff;

  while (page.next_cursor) {
    if (!live()) return undefined;
    page = await read({ task_id: taskId, scope, cursor: page.next_cursor });
    diff += page.diff;
  }

  if (!live()) return undefined;
  const { next_cursor: _, ...last } = page;

  return { ...last, diff };
}

/** What a task's changes depend on: a new status or turn reloads them. */
export const changesKey = (task: Task) => `${task.status}:${task.attempt}`;

/** Whether the selected task's changes need reading. */
export function changesStale(state: ChangesState | undefined, task: Task) {
  return (
    !state ||
    state.task !== task.id ||
    (!state.loading && state.key !== changesKey(task))
  );
}

/** "+12 −3, 4 files" */
export function changesSummary({ additions, deletions, files }: Changes) {
  return `+${additions} −${deletions}, ${files.length} ${files.length === 1 ? "file" : "files"}`;
}

import { terminal } from "./selectors";
import type { Snapshot, Task } from "./types";

/**
 * Selects a task, or none, with its detail cleared: its chat and activity
 * show as loading until their first reads return.
 */
export function selectionPatch(selected: string | undefined) {
  return {
    selected,
    events: [],
    droppedEvents: undefined,
    activityFocus: undefined,
    chat: undefined,
    chatHistoryLoading: selected,
    activityHistoryLoading: selected,
    draft: undefined,
  } satisfies Partial<Snapshot>;
}

/** The task worth opening first: one waiting for input, then an unfinished one, then the newest. */
export function defaultTask(tasks: Task[]) {
  return (
    tasks.find((task) => task.pending_input) ??
    tasks.find((task) => !terminal(task)) ??
    tasks[0]
  );
}

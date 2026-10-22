import { terminal } from "./selectors";
import type { Snapshot, Task } from "./types";

/**
 * Selects a task, or none, with its detail cleared: its chat and activity
 * show as loading until their first reads return. Selecting a task closes
 * the new-task composer. `tab` opens the task on that tab.
 */
export function selectionPatch(
  selected: string | undefined,
  tab?: Snapshot["tab"],
) {
  return {
    selected,
    ...(tab ? { tab } : {}),
    ...(selected ? { newTask: undefined } : {}),
    events: [],
    droppedEvents: undefined,
    activityFocus: undefined,
    chat: undefined,
    chatHistoryLoading: selected,
    activityHistoryLoading: selected,
    draft: undefined,
  } satisfies Partial<Snapshot>;
}

/**
 * The task worth opening first: one waiting for input, then an unfinished one,
 * then the newest. Archived tasks are never opened by default.
 */
export function defaultTask(tasks: Task[]) {
  const listed = tasks.filter((task) => !task.archived_at);

  return (
    listed.find((task) => task.pending_input) ??
    listed.find((task) => !terminal(task)) ??
    listed[0]
  );
}

/** The task a wide or scoped panel opens unless the user is browsing or composing. */
export function defaultSelection(
  tasks: Task[],
  state: Pick<Snapshot, "conversation" | "repository" | "newTask">,
  browsing: boolean,
  wide: boolean,
) {
  if (
    browsing ||
    state.newTask ||
    !(wide || state.conversation || state.repository)
  ) {
    return undefined;
  }

  return defaultTask(tasks)?.id;
}

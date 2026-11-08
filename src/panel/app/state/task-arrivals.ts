import type { Snapshot, Task } from "./types";

/** Arrival actions never leave forms, modal dialogs or other pages. */
function canViewTaskArrival(state: Snapshot) {
  return (
    state.page === "tasks" &&
    Boolean(state.selected) &&
    !state.newTask &&
    !state.dialog &&
    !state.busy
  );
}

/** Rechecks the target before rendering or following an arrival notification. */
export function taskArrivalTarget(state: Snapshot) {
  const { taskArrival } = state;

  return canViewTaskArrival(state) &&
    state.tasks.some((task) => task.id === taskArrival?.id && !task.archived_at)
    ? taskArrival
    : undefined;
}

/** Tracks tasks seen in the current scope, including ones temporarily absent. */
export class TaskArrivals {
  private listed?: { scope: number; ids: Set<string> };

  update(
    tasks: Task[],
    state: Snapshot,
    intent: { browsing: boolean; changedSelection: boolean },
  ) {
    const listed =
      this.listed?.scope === state.scopeVersion ? this.listed.ids : undefined;

    // A read completed task appears when Done or All loads it, not because it arrived.
    const arrived =
      listed &&
      tasks.find(
        (task) =>
          !listed.has(task.id) &&
          task.id !== state.selected &&
          !task.archived_at &&
          (task.status !== "completed" || task.unread),
      );

    const ids = listed ?? new Set<string>();
    for (const task of tasks) ids.add(task.id);
    this.listed = { scope: state.scopeVersion, ids };

    if (
      !canViewTaskArrival(state) ||
      intent.browsing ||
      intent.changedSelection
    ) {
      return undefined;
    }

    const candidate = arrived ?? state.taskArrival;

    const task = tasks.find(
      (task) => task.id === candidate?.id && !task.archived_at,
    );

    return task && task.id !== state.selected
      ? { id: task.id, title: task.title }
      : undefined;
  }
}

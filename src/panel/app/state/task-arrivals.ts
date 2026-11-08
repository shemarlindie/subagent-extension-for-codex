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
  private listed?: { scope: number; ids: Set<string>; newest: string };

  update(
    tasks: Task[],
    state: Snapshot,
    intent: { browsing: boolean; changedSelection: boolean },
  ) {
    const seen =
      this.listed?.scope === state.scopeVersion ? this.listed : undefined;

    // The list always has the newest task, so the older ones that Done and
    // All load, or that are unarchived, never count as arrivals.
    const arrived =
      seen &&
      tasks.find(
        (task) =>
          !seen.ids.has(task.id) &&
          task.id !== state.selected &&
          !task.archived_at &&
          task.created_at >= seen.newest,
      );

    const ids = seen?.ids ?? new Set<string>();
    let newest = seen?.newest ?? "";

    for (const task of tasks) {
      ids.add(task.id);
      if (task.created_at > newest) newest = task.created_at;
    }

    this.listed = { scope: state.scopeVersion, ids, newest };

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

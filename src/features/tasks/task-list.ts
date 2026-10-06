import type { Event, Task } from "../../shared/contracts.js";
import { currentActivityStatus } from "./activity/activity-timeline.js";

export type ListedTask = Task & {
  live_activity?: ReturnType<typeof currentActivityStatus>;
};

/** Activity summaries are derived for the list, never persisted as task state. */
export function listedTask(task: Task, events: Event[]): ListedTask {
  return task.status === "running"
    ? { ...task, live_activity: currentActivityStatus(events, task) }
    : task;
}

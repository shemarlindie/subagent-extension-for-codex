import { rowStatus } from "./task-status";
import type { Snapshot, Task } from "./types";
export const terminal = (task: Task) =>
  ["completed", "failed", "cancelled"].includes(task.status);
export const locked = (task: Task) =>
  task.waiting_reason === "termination_unconfirmed";
export const statusLabel = (task: Task) =>
  locked(task)
    ? "Shutdown unconfirmed"
    : task.pending_input
      ? "Needs input"
      : task.waiting_reason === "waiting_for_dependency"
        ? "Waiting on dependency"
        : task.status[0].toUpperCase() + task.status.slice(1);
export const profileLabel = (profile: string) => profile.replaceAll("_", " ");
// A failed row status (including interrupted and unconfirmed shutdown) places
// a task in Failed alone; the other filters never overlap except through All.
export const failedStatus = (task: Task) =>
  ["failed", "unconfirmed", "interrupted"].includes(rowStatus(task).kind);
export const needsInput = (task: Task) => Boolean(task.pending_input);
export function visibleTasks(state: Snapshot) {
  const search = state.search.toLowerCase();
  return state.tasks.filter(
    (task) =>
      (!state.repository || task.repository === state.repository) &&
      (!state.workerRoute ||
        `${task.provider}.${task.worker_profile}` === state.workerRoute) &&
      (!search ||
        `${task.title} ${task.description} ${task.worker_profile} ${task.id}`
          .toLowerCase()
          .includes(search)) &&
      (state.filter === "all" ||
        (state.filter === "active" && !terminal(task) && !failedStatus(task)) ||
        (state.filter === "attention" &&
          needsInput(task) &&
          !failedStatus(task)) ||
        (state.filter === "completed" && task.status === "completed") ||
        (state.filter === "failed" && failedStatus(task))),
  );
}
export function projectChoices(state: Snapshot) {
  const choices = state.projects.filter(
    (project) => project.kind === "repository",
  );
  return state.repository &&
    !choices.some((project) => project.repository === state.repository)
    ? [{ repository: state.repository, kind: "repository" }, ...choices]
    : choices;
}
export const selectedTask = (state: Snapshot) =>
  state.tasks.find((task) => task.id === state.selected);

import type {
  Filter,
  Question,
  Snapshot,
  Task,
} from "../../../app/state/types.js";
import { rowStatus } from "./task-status.js";

// Display order of the status filters; the panel hides "attention" without the capability.
export const FILTER_LABELS: Record<Filter, string> = {
  attention: "Needs input",
  failed: "Failed",
  active: "Active",
  completed: "Done",
  all: "All",
};

const FILTERS = Object.keys(FILTER_LABELS) as Filter[];

export const terminal = (task: Task) =>
  ["completed", "failed"].includes(task.status);

/** No turn is running, starting or about to, so a message starts the next one. */
export const idle = (task: Task) =>
  ["completed", "failed", "interrupted"].includes(task.status);

export const statusLabel = (task: Task) =>
  task.pending_input
    ? "Needs input"
    : task.waiting_reason === "waiting_for_dependency"
      ? "Waiting on dependency"
      : task.status[0].toUpperCase() + task.status.slice(1);

export const profileLabel = (profile: string) => profile.replaceAll("_", " ");

// A failed row status (including interrupted) places a task in Failed alone;
// the other filters never overlap except through All.
export const failedStatus = (task: Task) =>
  ["failed", "interrupted"].includes(rowStatus(task).kind);

export const needsInput = (task: Task) => Boolean(task.pending_input);

// One AskUserQuestion call carries every stacked question in `questions`
// (1-4 in the Claude SDK). A request without them has no questions to show.
export const pendingQuestions = (task: Task): Question[] => {
  const questions = task.pending_input?.input.questions;

  return Array.isArray(questions) ? (questions as Question[]) : [];
};

// Each task lands in one status filter besides All; see failedStatus.
const matchesFilter = (task: Task, filter: Filter) =>
  filter === "all" ||
  (filter === "active" && !terminal(task) && !failedStatus(task)) ||
  (filter === "attention" && needsInput(task) && !failedStatus(task)) ||
  (filter === "completed" && task.status === "completed") ||
  (filter === "failed" && failedStatus(task));

// Tasks in the chosen project and search, before the status filter applies.
export function scopedTasks(state: Snapshot) {
  const search = state.search.toLowerCase();

  return state.tasks.filter(
    (task) =>
      (!state.repository || task.repository === state.repository) &&
      (!search ||
        `${task.title} ${task.description} ${task.worker_profile} ${task.id}`
          .toLowerCase()
          .includes(search)),
  );
}

// The chosen filter, or until one is chosen, the first in display order that holds tasks.
export function effectiveFilter(state: Snapshot): Filter {
  if (state.filter) return state.filter;
  const counts = filterCounts(state);

  return FILTERS.find((filter) => counts[filter] > 0) ?? "all";
}

export const visibleTasks = (state: Snapshot) => {
  const filter = effectiveFilter(state);

  return scopedTasks(state).filter((task) => matchesFilter(task, filter));
};

export function filterCounts(state: Snapshot) {
  const scoped = scopedTasks(state);

  return Object.fromEntries(
    FILTERS.map((filter) => [
      filter,
      scoped.filter((task) => matchesFilter(task, filter)).length,
    ]),
  ) as Record<Filter, number>;
}

export const selectedTask = (state: Snapshot) =>
  state.tasks.find((task) => task.id === state.selected);

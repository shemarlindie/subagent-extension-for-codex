import type {
  Filter,
  Question,
  Snapshot,
  Task,
} from "../../../app/state/types.js";
import { rowStatus } from "./task-status.js";

// Display order of the filters; the panel hides "attention" without the capability.
export const FILTER_LABELS: Record<Filter, string> = {
  unread: "Unread",
  attention: "Needs input",
  failed: "Failed",
  active: "Active",
  completed: "Done",
  all: "All",
};

const FILTERS = Object.keys(FILTER_LABELS) as Filter[];

// Reading a task changes Unread's count, so the list never opens on it by itself.
const DEFAULT_FILTERS = FILTERS.filter((filter) => filter !== "unread");

export const terminal = (task: Task) =>
  ["completed", "failed"].includes(task.status);

export const statusLabel = (task: Task) => {
  if (task.pending_input) return "Needs input";

  if (task.waiting_reason === "waiting_for_dependency") {
    return "Waiting on dependency";
  }

  return task.status.charAt(0).toUpperCase() + task.status.slice(1);
};

export const profileLabel = (profile: string) => profile.replaceAll("_", " ");

// A failed row status (including interrupted) places a task in Failed alone;
// the other filters never overlap except through All.
export const failedStatus = (task: Task) =>
  ["failed", "interrupted"].includes(rowStatus(task).kind);

const needsInput = (task: Task) => Boolean(task.pending_input);

// One AskUserQuestion call carries every stacked question in `questions`
// (1-4 in the Claude SDK). A request without them has no questions to show.
export const pendingQuestions = (task: Task): Question[] => {
  const questions = task.pending_input?.input.questions;

  return Array.isArray(questions) ? (questions as Question[]) : [];
};

// Each task lands in one status filter besides All; see failedStatus. Unread
// cuts across them.
const matchesFilter = (task: Task, filter: Filter) =>
  filter === "all" ||
  (filter === "unread" && Boolean(task.unread)) ||
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

  return DEFAULT_FILTERS.find((filter) => counts[filter] > 0) ?? "all";
}

// Under Unread, the open task stays listed once read, until another is chosen.
export const visibleTasks = (state: Snapshot) => {
  const filter = effectiveFilter(state);

  return scopedTasks(state).filter(
    (task) =>
      matchesFilter(task, filter) ||
      (filter === "unread" && task.id === state.selected),
  );
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

import type {
  Filter,
  Question,
  Snapshot,
  Task,
} from "../../../app/state/types.js";
import { rowStatus, statusTone } from "./task-status.js";

// Display order of the filters; the panel hides "attention" without the capability.
export const FILTER_LABELS: Record<Filter, string> = {
  unread: "Unread",
  attention: "Needs attention",
  failed: "Failed",
  active: "Working",
  completed: "Done",
  all: "All",
};

const FILTERS = Object.keys(FILTER_LABELS) as Filter[];

// Reading a task changes Unread's count, so the list never opens on it by itself.
const DEFAULT_FILTERS = FILTERS.filter((filter) => filter !== "unread");

/**
 * A turn you stopped. Its stop clears any error, while a service restart
 * leaves one asking you to continue.
 */
const stopped = (task: Task) => task.status === "interrupted" && !task.error;

export const terminal = (task: Task) =>
  ["completed", "failed"].includes(task.status) || stopped(task);

// Limits you set, named so they read apart from errors.
const LIMIT_LABELS: Partial<Record<string, string>> = {
  cost_budget_exhausted: "Cost limit reached",
  runtime_budget_exhausted: "Runtime limit reached",
  error_max_turns: "Turn limit reached",
};

export const statusLabel = (task: Task) => {
  if (task.pending_input) return "Needs input";
  if (stopped(task)) return "Stopped";

  const limit =
    task.status === "failed" && task.error_code
      ? LIMIT_LABELS[task.error_code]
      : undefined;

  return limit ?? task.status.charAt(0).toUpperCase() + task.status.slice(1);
};

export const profileLabel = (profile: string) => profile.replaceAll("_", " ");

// A failed row status, or an interruption you didn't ask for, places a task in
// Failed alone. The other filters never overlap except through All.
const failedStatus = (task: Task) => {
  const { kind } = rowStatus(task);

  return kind === "failed" || (kind === "interrupted" && !stopped(task));
};

const done = (task: Task) => task.status === "completed" || stopped(task);

/** Tasks with the yellow dot: waiting on you or on a rate limit reset. */
export const needsAttention = (task: Task) =>
  statusTone(rowStatus(task).kind) === "attention";

/** Unfinished tasks that need nothing from you, including queued turns. */
export const working = (task: Task) =>
  !terminal(task) && !failedStatus(task) && !needsAttention(task);

/** The snapshot fields the task list selectors read. */
export const TASK_LIST_FIELDS = [
  "tasks",
  "readCompleted",
  "repository",
  "search",
  "filter",
  "selected",
  "previousTask",
] as const;

export type TaskListState = Pick<Snapshot, (typeof TASK_LIST_FIELDS)[number]>;

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
  (filter === "active" && working(task)) ||
  (filter === "attention" && needsAttention(task)) ||
  (filter === "completed" && done(task)) ||
  (filter === "failed" && failedStatus(task));

// Tasks in the chosen project and search, before the status filter applies.
// Archived tasks are left out. The Projects page lists them.
export function scopedTasks(
  state: Pick<TaskListState, "tasks" | "repository" | "search">,
) {
  const search = state.search.toLowerCase();

  return state.tasks.filter(
    (task) =>
      !task.archived_at &&
      (!state.repository || task.repository === state.repository) &&
      (!search ||
        `${task.title} ${task.description} ${task.worker_profile} ${task.id}`
          .toLowerCase()
          .includes(search)),
  );
}

// The chosen filter, or until one is chosen, the first in display order that holds tasks.
export function effectiveFilter(state: TaskListState): Filter {
  if (state.filter) return state.filter;
  const counts = filterCounts(state);

  return DEFAULT_FILTERS.find((filter) => counts[filter] > 0) ?? "all";
}

/** The task the list marks: the open one, or the last one closed. */
export const listedTask = (
  state: Pick<Snapshot, "selected" | "previousTask">,
) => state.selected ?? state.previousTask;

// Under Unread, the marked task stays listed once read, until another is chosen.
// Across projects, tasks come in display order: grouped by project.
export const visibleTasks = (state: TaskListState) => {
  const filter = effectiveFilter(state);

  const tasks = scopedTasks(state).filter(
    (task) =>
      matchesFilter(task, filter) ||
      (filter === "unread" && task.id === listedTask(state)),
  );

  return state.repository
    ? tasks
    : tasksByProject(tasks).flatMap((group) => group.tasks);
};

type ProjectTasks = { repository: string; tasks: Task[] };

// Groups keep the list's order: each project sits where its first task was.
export function tasksByProject(tasks: Task[]): ProjectTasks[] {
  const groups = new Map<string, Task[]>();

  for (const task of tasks) {
    const group = groups.get(task.repository);

    if (group) group.push(task);
    else groups.set(task.repository, [task]);
  }

  return [...groups].map(([repository, tasks]) => ({ repository, tasks }));
}

/** Rows a project group shows before "Show more" when several projects share the list. */
export const GROUP_ROW_LIMIT = 5;

/**
 * A long group's rows before "Show more": the first few, plus the selected
 * task wherever it sits. When only one row would hide, the group shows it.
 */
export function groupRows(tasks: Task[], selected?: string) {
  const shown = tasks.filter(
    (task, index) => index < GROUP_ROW_LIMIT || task.id === selected,
  );

  const hidden = tasks.filter((task) => !shown.includes(task));

  return hidden.length > 1 ? { shown, hidden } : { shown: tasks, hidden: [] };
}

/**
 * What a group's header or "Show more" row flags about tasks it hides: one dot
 * each for attention, work and unread. A task that needs input names the
 * attention dot before one paused by a rate limit.
 */
export function groupSignals(tasks: Task[]) {
  const statuses = tasks.map(rowStatus);

  const toned = (tone: ReturnType<typeof statusTone>) =>
    statuses.find((status) => statusTone(status.kind) === tone);

  return {
    attention:
      statuses.find((status) => status.kind === "input") ?? toned("attention"),
    working: toned("working"),
    unread: tasks.some((task) => task.unread),
  };
}

// Done and All count read completed tasks the list hasn't loaded. A search
// loads them, so it never counts them unloaded.
export function filterCounts(state: TaskListState) {
  const scoped = scopedTasks(state);

  const unloaded = state.search
    ? 0
    : Object.entries(state.readCompleted ?? {})
        .filter(
          ([repository]) =>
            !state.repository || repository === state.repository,
        )
        .reduce((total, [, count]) => total + count, 0);

  return Object.fromEntries(
    FILTERS.map((filter) => [
      filter,
      scoped.filter((task) => matchesFilter(task, filter)).length +
        (filter === "completed" || filter === "all" ? unloaded : 0),
    ]),
  ) as Record<Filter, number>;
}

/** A restored filter, or none when it no longer holds tasks in scope. */
export function availableFilter(state: TaskListState, filter: Filter | null) {
  if (!filter || filter === "all") return filter;

  // Search may have no matches while its chosen status remains valid in scope.
  return filterCounts({ ...state, search: "" })[filter] > 0 ? filter : null;
}

/**
 * Whether the list shows completed tasks the user has read, which load on
 * demand. The default filter is unknown while nothing is listed. A scope with
 * tasks always lists its newest.
 */
export function showsReadCompleted(state: TaskListState) {
  const filter =
    state.filter ?? (state.tasks.length ? effectiveFilter(state) : undefined);

  return Boolean(state.search) || filter === "completed" || filter === "all";
}

export const selectedTask = (state: Pick<Snapshot, "tasks" | "selected">) =>
  state.tasks.find((task) => task.id === state.selected);

export const findTask = (state: Pick<Snapshot, "tasks">, id: string) =>
  state.tasks.find((task) => task.id === id);

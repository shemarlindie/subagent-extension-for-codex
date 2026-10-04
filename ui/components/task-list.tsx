import { useRef } from "react";
import {
  FILTER_LABELS,
  locked,
  profileLabel,
  scopedTasks,
  terminal,
  visibleTasks,
} from "../core/selectors";
import { rowStatus } from "../core/task-status";
import { formatDuration, runtimeLive, taskRuntimeMs } from "../core/duration";
import { useNow } from "./use-now";
import { useListMotion } from "./motion";
import type { Filter, Task } from "../core/types";
import { useController, useSnapshot } from "./controller-context";
import { Button } from "./button";
import { TaskStatusIcon } from "./task-status-icon";
interface TaskRowProps {
  task: Task;
  selected: boolean;
  onSelect(): void;
}

export function TaskRow({ task, selected, onSelect }: TaskRowProps) {
  return (
    <button
      className="row"
      data-task={task.id}
      aria-current={selected}
      onClick={onSelect}
    >
      <span className="row-title">{task.title}</span>
      <span className="row-meta">
        <span className="row-worker">{profileLabel(task.worker_profile)}</span>
        <span className="row-trailing">
          <TaskRowRuntime task={task} />
          <TaskRowStatus task={task} />
        </span>
      </span>
    </button>
  );
}

function TaskRowStatus({ task }: { task: Task }) {
  const { kind, label } = rowStatus(task);
  return <TaskStatusIcon kind={kind} label={label} />;
}

function TaskRowRuntime({ task }: { task: Task }) {
  const status = rowStatus(task),
    activityLabel =
      (task.status === "running" &&
        (status.kind === "failed" ||
          status.kind === "paused" ||
          status.kind === "input")) ||
      Boolean(task.pending_input) ||
      locked(task),
    live = runtimeLive(task) && !activityLabel,
    now = useNow(live),
    runtime = taskRuntimeMs(task, now);
  // Attention states and tasks without an active clock use their short label.
  const label =
    activityLabel || (!live && !terminal(task)) ? status.shortLabel : undefined;
  const duration = formatDuration(runtime);
  return (
    <span
      className="row-runtime"
      title={label ? status.label : "Total run time across attempts"}
    >
      {label ??
        (task.status === "cancelled"
          ? `Stopped after ${duration}`
          : task.status === "failed"
            ? `Failed after ${duration}`
            : live
              ? duration
              : `${terminal(task) ? "Ran for" : "Run time"} ${duration}`)}
    </span>
  );
}
const EMPTY_FILTER: Record<Filter, string> = {
  all: "No tasks yet. Start a task to see it here.",
  active: "No active tasks.",
  attention: "No tasks need input.",
  completed: "No completed tasks.",
  failed: "No failed tasks.",
};
export function TaskList() {
  const controller = useController(),
    state = useSnapshot(),
    tasks = visibleTasks(state),
    total = scopedTasks({ ...state, search: "", filter: "all" }).length,
    narrowed = state.filter !== "all" || Boolean(state.search),
    filterLabel = FILTER_LABELS[state.filter],
    listRef = useRef<HTMLDivElement>(null);
  useListMotion(listRef, "data-task", tasks.map((task) => task.id).join());
  const resetFilters = () => {
    controller.setSearch("");
    controller.setFilter("all");
  };
  return (
    <>
      <div className="list-label">
        <span id="scope">
          {state.conversation ? "This conversation" : "All conversations"}
        </span>
        <span className="list-count">
          {narrowed && (
            <Button variant="text" underline onClick={resetFilters}>
              Reset
            </Button>
          )}
          <span id="count">
            {state.mode === "console"
              ? `${narrowed ? `${tasks.length} OF ${total}` : tasks.length} TASK${total === 1 ? "" : "S"}`
              : narrowed
                ? `${tasks.length} of ${total}`
                : tasks.length}
          </span>
        </span>
      </div>
      <div id="task-list" ref={listRef}>
        {!state.connected ? (
          <p className="help">
            {state.connection === "Open through MCP"
              ? "Ask Codex to call open_codex_subagent_extension. To preview the panel during development, run npm run dev:ui."
              : "Waiting for the host connection."}
          </p>
        ) : tasks.length ? (
          tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              selected={task.id === state.selected}
              onSelect={() => controller.run(() => controller.select(task.id))}
            />
          ))
        ) : (
          <p className="help">
            {state.search
              ? `No tasks match “${state.search}”${state.filter === "all" ? "" : ` in ${filterLabel}`}.`
              : EMPTY_FILTER[state.filter]}
          </p>
        )}
      </div>
    </>
  );
}

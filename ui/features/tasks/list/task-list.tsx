import { useEffect, useLayoutEffect, useRef } from "react";

import { Button } from "../../../shared/components/button";
import { useListMotion } from "../../../shared/components/motion";
import { useNow } from "../../../shared/components/use-now";
import {
  useController,
  useSnapshot,
} from "../../../shared/state/controller-context";
import {
  effectiveFilter,
  FILTER_LABELS,
  profileLabel,
  projectChoices,
  scopedTasks,
  terminal,
  visibleTasks,
} from "../../../shared/state/selectors";
import type { Filter, Task } from "../../../shared/state/types";
import { animateScrollIntoView } from "../../../shared/utils/animate-scroll-into-view";
import { formatDuration, runtimeLive, taskRuntimeMs } from "./duration";
import { rowStatus } from "./task-status";
import { TaskStatusIcon } from "./task-status-icon";
import { WorkerProfileIcon } from "./worker-profile-icon";

interface TaskRowProps {
  task: Task;
  projectName?: string;
  selected: boolean;
  onSelect(): void;
}

export function TaskRow({
  task,
  projectName,
  selected,
  onSelect,
}: TaskRowProps) {
  return (
    <button
      className="row"
      data-task={task.id}
      aria-current={selected}
      onClick={onSelect}
    >
      {projectName && (
        <span className="row-project" title={projectName}>
          {projectName}
        </span>
      )}
      <span className="row-title">{task.title}</span>
      <span className="row-meta">
        <span className="row-worker">
          <WorkerProfileIcon
            profile={task.worker_profile}
            className="row-worker-icon"
          />
          <span className="row-worker-label">
            {profileLabel(task.worker_profile)}
          </span>
        </span>
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
      Boolean(task.pending_input),
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
      title={label ? status.label : "Total run time across turns"}
    >
      {label ??
        (task.status === "failed"
          ? `Failed after ${duration}`
          : live
            ? duration
            : `${terminal(task) ? "Ran for" : "Run time"} ${duration}`)}
    </span>
  );
}

const EMPTY_FILTER: Record<Filter, string> = {
  all: "No tasks yet.",
  active: "No active tasks.",
  attention: "No tasks need input.",
  completed: "No completed tasks.",
  failed: "No failed tasks.",
};

export function TaskList() {
  const controller = useController(),
    state = useSnapshot(),
    tasks = visibleTasks(state),
    total = scopedTasks({ ...state, search: "", filter: null }).length,
    filter = effectiveFilter(state),
    narrowed = tasks.length < total || Boolean(state.search),
    filterLabel = FILTER_LABELS[filter],
    projectNames = new Map(
      projectChoices(state).map((project) => [
        project.repository,
        (project.name ||
          project.repository.split(/[\\/]/).filter(Boolean).at(-1)) ??
          project.repository,
      ]),
    ),
    listRef = useRef<HTMLDivElement>(null),
    scrolledOnLoad = useRef(false),
    cancelScroll = useRef<(() => void) | undefined>(undefined);

  useListMotion(listRef, "data-task", tasks.map((task) => task.id).join());

  // Selection and task data can arrive after mount; scroll once the row exists.
  useLayoutEffect(() => {
    if (scrolledOnLoad.current) return;

    const row = listRef.current?.querySelector<HTMLElement>(
      '[data-task][aria-current="true"]',
    );

    if (!row) return;

    cancelScroll.current = animateScrollIntoView(row);

    scrolledOnLoad.current = true;
  });

  useEffect(
    () => () => {
      cancelScroll.current?.();
      scrolledOnLoad.current = false;
    },
    [],
  );

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
              Clear filter
            </Button>
          )}
          <span id="count">
            {narrowed ? `${tasks.length} of ${total}` : tasks.length}
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
              projectName={
                state.repository
                  ? undefined
                  : ((projectNames.get(task.repository) ||
                      task.repository.split(/[\\/]/).filter(Boolean).at(-1)) ??
                    task.repository)
              }
              selected={task.id === state.selected}
              onSelect={() => controller.run(() => controller.select(task.id))}
            />
          ))
        ) : (
          <p className="help empty-state">
            {state.search
              ? `No tasks match “${state.search}”${filter === "all" ? "" : ` in ${filterLabel}`}.`
              : EMPTY_FILTER[filter]}
          </p>
        )}
      </div>
    </>
  );
}

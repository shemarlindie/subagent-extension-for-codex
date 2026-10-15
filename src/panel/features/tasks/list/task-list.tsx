import { ContextMenu } from "@base-ui/react/context-menu";
import { useEffect, useLayoutEffect, useRef } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import {
  effectiveFilter,
  FILTER_LABELS,
  profileLabel,
  projectChoices,
  scopedTasks,
  terminal,
  visibleTasks,
} from "../../../app/state/selectors";
import type { Filter, Task } from "../../../app/state/types";
import { Button } from "../../../shared/components/button/button";
import { SkeletonShape } from "../../../shared/components/loading-skeleton/loading-skeleton";
import { LoadingSwap } from "../../../shared/components/loading-skeleton/loading-swap";
import { useListMotion } from "../../../shared/components/motion/use-list-motion";
import { animateScrollIntoView } from "../../../shared/utils/animate-scroll-into-view";
import { useNow } from "../../../shared/utils/use-now";
import { NewTaskRow } from "../../delegation/new-task/new-task-row";
import { projectDisplayName } from "../../projects/selectors";
import { UnseenDot } from "../seen/unseen-dot";
import { formatDuration, runtimeLive, taskRuntimeMs } from "./duration";
import { TaskListScrollbar } from "./task-list-scrollbar";
import { TaskListSkeleton } from "./task-list-skeleton";
import { rowStatus } from "./task-status";
import { TaskStatusIcon } from "./task-status-icon";
import { WorkerProfileIcon } from "./worker-profile-icon";

interface TaskRowProps {
  task: Task;
  projectName?: string;
  selected: boolean;
  onSelect(): void;
  /** Marks the task seen when it's unseen, otherwise unseen. */
  onToggleSeen(): void;
}

/** A task in the list; right-click or long-press marks it seen or unseen. */
export function TaskRow({
  task,
  projectName,
  selected,
  onSelect,
  onToggleSeen,
}: TaskRowProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        render={
          <button
            className="row"
            data-task={task.id}
            data-unseen={task.unseen ? "" : undefined}
            aria-current={selected}
            onClick={onSelect}
          />
        }
      >
        <TaskRowContent task={task} projectName={projectName} />
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="menu-positioner">
          <ContextMenu.Popup className="menu-popup">
            <ContextMenu.Item
              className="menu-item"
              data-action={task.unseen ? "mark-seen" : "mark-unseen"}
              onClick={onToggleSeen}
            >
              {task.unseen ? "Mark as seen" : "Mark as unseen"}
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

type TaskRowContentProps = Pick<TaskRowProps, "task" | "projectName">;

function TaskRowContent({ task, projectName }: TaskRowContentProps) {
  return (
    <>
      {task.unseen && <UnseenDot className="row-unseen" />}
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
    </>
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
      {label ?? runtimeText(task, live, duration)}
    </span>
  );
}

function runtimeText(task: Task, live: boolean, duration: string) {
  if (task.status === "failed") return `Failed after ${duration}`;
  if (live) return duration;

  return `${terminal(task) ? "Ran for" : "Run time"} ${duration}`;
}

const EMPTY_FILTER: Record<Filter, string> = {
  all: "No tasks yet.",
  unseen: "You're all caught up.",
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
        projectDisplayName(project),
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

  // Rows, or the message that replaces them when offline or when nothing matches.
  const renderRows = () => {
    if (!state.connected) {
      return (
        <p className="help">
          {state.connection === "Open through MCP"
            ? "Ask Codex to call open_codex_subagent_extension. To preview the panel during development, run npm run dev:ui."
            : "Waiting for the host connection."}
        </p>
      );
    }

    if (tasks.length) {
      return tasks.map((task) => (
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
          onToggleSeen={() => toggleSeen(task)}
        />
      ));
    }

    return (
      <p className="help empty-state">
        {state.search
          ? `No tasks match “${state.search}”${filter === "all" ? "" : ` in ${filterLabel}`}.`
          : EMPTY_FILTER[filter]}
      </p>
    );
  };

  const resetFilters = () => {
    controller.setSearch("");
    controller.setFilter("all");
  };

  const toggleSeen = (task: Task) =>
    controller.run(() => controller.taskActions.seen.toggle(task));

  // Under Unseen, the listed tasks can all be seen at once. Without a search
  // to clear, this takes Clear filter's place; the All pill does the same.
  const unseenShown = filter === "unseen" && tasks.some((task) => task.unseen);
  const clearShown = narrowed && (!unseenShown || Boolean(state.search));

  const markAllSeen = () =>
    controller.run(() => controller.taskActions.seen.markAllSeen(tasks));

  return (
    <>
      <div className="list-label">
        <span id="scope">
          {state.conversation ? "This conversation" : "All conversations"}
        </span>
        <span className="list-count">
          {unseenShown && (
            <Button variant="text" underline onClick={markAllSeen}>
              Mark all seen
            </Button>
          )}
          {clearShown && (
            <Button variant="text" underline onClick={resetFilters}>
              Clear filter
            </Button>
          )}
          <span id="count">
            <LoadingSwap
              as="span"
              className="loading-swap-inline"
              loading={state.taskListLoading}
              busy={false}
              skeleton={
                <SkeletonShape
                  className={`task-list-count-skeleton${narrowed ? " task-list-count-skeleton-filtered" : ""}`}
                />
              }
            >
              {narrowed ? `${tasks.length} of ${total}` : tasks.length}
            </LoadingSwap>
          </span>
        </span>
      </div>
      <div className="task-list-scroll-area">
        <div id="task-list" ref={listRef}>
          <LoadingSwap
            className="task-list-loading-swap"
            loading={state.taskListLoading}
            skeleton={<TaskListSkeleton showProject={!state.repository} />}
          >
            {state.taskListLoading ? null : (
              <>
                {state.newTask && <NewTaskRow />}
                {renderRows()}
              </>
            )}
          </LoadingSwap>
        </div>
        {!state.taskListLoading && <TaskListScrollbar scrollerRef={listRef} />}
      </div>
    </>
  );
}

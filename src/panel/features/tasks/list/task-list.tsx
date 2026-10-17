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
  tasksByProject,
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
import { UnreadDot } from "../unread/unread-dot";
import { formatDuration, runtimeLive, taskRuntimeMs } from "./duration";
import { TaskGroup } from "./task-group";
import { TaskListScrollbar } from "./task-list-scrollbar";
import { TaskListSkeleton } from "./task-list-skeleton";
import { rowStatus } from "./task-status";
import { TaskStatusIcon } from "./task-status-icon";
import { WorkerProfileIcon } from "./worker-profile-icon";

interface TaskRowProps {
  task: Task;
  selected: boolean;
  onSelect(): void;
  /** Marks the task read when it's unread, otherwise unread. */
  onToggleRead(): void;
}

/** A task in the list; right-click or long-press marks it read or unread. */
export function TaskRow({
  task,
  selected,
  onSelect,
  onToggleRead,
}: TaskRowProps) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        render={
          <button
            className="row"
            data-task={task.id}
            data-unread={task.unread ? "" : undefined}
            aria-current={selected}
            onClick={onSelect}
          />
        }
      >
        <TaskRowContent task={task} />
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="menu-positioner">
          <ContextMenu.Popup className="menu-popup">
            <ContextMenu.Item
              className="menu-item"
              data-action={task.unread ? "mark-read" : "mark-unread"}
              onClick={onToggleRead}
            >
              {task.unread ? "Mark read" : "Mark unread"}
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

type TaskRowContentProps = Pick<TaskRowProps, "task">;

// The icon tells profiles apart, so the worker's name is in its tooltip and
// for screen readers only.
function TaskRowContent({ task }: TaskRowContentProps) {
  const worker = profileLabel(task.worker_profile);

  return (
    <>
      <span className="row-title">{task.title}</span>
      <span className="row-meta">
        <span className="row-worker" title={worker}>
          <WorkerProfileIcon
            profile={task.worker_profile}
            className="row-worker-icon"
          />
          {task.unread && <UnreadDot />}
          <span className="row-worker-label visually-hidden">{worker}</span>
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
  // Finished tasks say their time is final; the status icon says how it ended.
  const label =
    activityLabel || (!live && !terminal(task)) ? status.shortLabel : undefined;

  const duration = formatDuration(runtime);

  return (
    <span
      className="row-runtime"
      title={label ? status.label : "Total run time across turns"}
    >
      {label ?? (terminal(task) ? `Ran for ${duration}` : duration)}
    </span>
  );
}

const EMPTY_FILTER: Record<Filter, string> = {
  all: "No tasks yet.",
  unread: "You're all caught up.",
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

  const order = tasks.map((task) => task.id).join();

  useListMotion(listRef, "data-task", order);
  useListMotion(listRef, "data-task-group", order);

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
      const renderRow = (task: Task) => (
        <TaskRow
          key={task.id}
          task={task}
          selected={task.id === state.selected}
          onSelect={() => controller.run(() => controller.select(task.id))}
          onToggleRead={() => toggleRead(task)}
        />
      );

      if (state.repository) return tasks.map(renderRow);

      // Across projects, each project's tasks sit under its own header.
      return tasksByProject(tasks).map(({ repository, tasks }) => (
        <TaskGroup
          key={repository}
          repository={repository}
          name={
            projectNames.get(repository) ?? projectDisplayName({ repository })
          }
        >
          {tasks.map(renderRow)}
        </TaskGroup>
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

  const toggleRead = (task: Task) =>
    controller.run(() => controller.taskActions.unread.toggle(task));

  // Under Unread, the listed tasks can all be read at once. Without a search
  // to clear, this takes Clear filter's place; the All pill does the same.
  const unreadShown = filter === "unread" && tasks.some((task) => task.unread);
  const clearShown = narrowed && (!unreadShown || Boolean(state.search));

  const markAllRead = () =>
    controller.run(() => controller.taskActions.unread.markAllRead(tasks));

  return (
    <>
      <div className="list-label">
        <span id="scope">
          {state.conversation ? "This conversation" : "All conversations"}
        </span>
        <span className="list-count">
          {unreadShown && (
            <Button variant="text" underline onClick={markAllRead}>
              Mark all read
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
            skeleton={<TaskListSkeleton />}
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

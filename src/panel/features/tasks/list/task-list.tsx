import { ContextMenu } from "@base-ui/react/context-menu";
import { useEffect, useLayoutEffect, useRef } from "react";

import { archivable } from "../../../../shared/tasks/archive.js";
import { CONNECTION } from "../../../app/state/connection";
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
  TASK_LIST_FIELDS,
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
import { ProjectGroups } from "./project-groups";
import { TaskListScrollbar } from "./task-list-scrollbar";
import { TaskListSkeleton } from "./task-list-skeleton";
import { rowStatus } from "./task-status";
import { TaskStatusIcon } from "./task-status-icon";
import { WorkerProfileIcon } from "./worker-profile-icon";

interface TaskRowProps {
  task: Task;
  selected: boolean;
  onSelect: () => void;
  /** Marks the task read when it's unread, otherwise unread. */
  onToggleRead: () => void;
  /** Archives the task, once it has stopped. */
  onArchive: () => void;
}

/** A task in the list; right-click or long-press marks it read or unread, or archives it. */
export function TaskRow({
  task,
  selected,
  onSelect,
  onToggleRead,
  onArchive,
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
            <ContextMenu.Item
              className="menu-item"
              data-action="archive"
              disabled={!archivable(task)}
              onClick={onArchive}
            >
              Archive
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
            size={12}
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
  const controller = useController();
  const list = useSnapshot(TASK_LIST_FIELDS);

  const {
    projects,
    connected,
    connection,
    conversation,
    taskListLoading,
    composing,
  } = useSnapshot(
    ["projects", "connected", "connection", "conversation", "taskListLoading"],
    (state) => ({ composing: Boolean(state.newTask) }),
  );

  const tasks = visibleTasks(list);
  const total = scopedTasks({ ...list, search: "" }).length;
  const filter = effectiveFilter(list);
  const narrowed = tasks.length < total || Boolean(list.search);
  const filterLabel = FILTER_LABELS[filter];

  const projectNames = new Map(
    projectChoices({ projects, repository: list.repository }).map((project) => [
      project.repository,
      projectDisplayName(project),
    ]),
  );

  const projectName = (repository: string) =>
    projectNames.get(repository) ?? projectDisplayName({ repository });

  const listRef = useRef<HTMLDivElement>(null);
  const scrolledOnLoad = useRef(false);
  const cancelScroll = useRef<(() => void) | undefined>(undefined);

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
    if (!connected) {
      return (
        <p className="help">
          {connection === CONNECTION.hostRequired
            ? "Ask Codex to call open_subagent_extension_for_codex. To preview the panel during development, run npm run dev:ui."
            : "Waiting for the host connection."}
        </p>
      );
    }

    if (tasks.length) {
      const renderRow = (task: Task) => (
        <TaskRow
          key={task.id}
          task={task}
          selected={task.id === list.selected}
          onSelect={() => controller.run(() => controller.select(task.id))}
          onToggleRead={() => toggleRead(task)}
          onArchive={() => archive(task)}
        />
      );

      if (list.repository) return tasks.map(renderRow);

      // Across projects, each project's tasks sit under their own header.
      return (
        <ProjectGroups
          tasks={tasks}
          projectName={projectName}
          renderRow={renderRow}
        />
      );
    }

    return (
      <p className="help empty-state">
        {list.search
          ? `No tasks match “${list.search}”${filter === "all" ? "" : ` in ${filterLabel}`}.`
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

  const archive = (task: Task) =>
    controller.run(() =>
      controller.taskActions.archive.setArchived([task], true),
    );

  // Under Unread, the listed tasks can all be read at once. Without a search
  // to clear, this takes Clear filter's place; the All pill does the same.
  const unreadShown = filter === "unread" && tasks.some((task) => task.unread);
  const clearShown = narrowed && (!unreadShown || Boolean(list.search));

  const markAllRead = () =>
    controller.run(() => controller.taskActions.unread.markAllRead(tasks));

  return (
    <>
      <div className="list-label">
        <span id="scope">
          {conversation ? "This conversation" : "All conversations"}
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
              loading={taskListLoading}
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
            loading={taskListLoading}
            skeleton={<TaskListSkeleton />}
          >
            {taskListLoading ? null : (
              <>
                {composing && <NewTaskRow />}
                {renderRows()}
              </>
            )}
          </LoadingSwap>
        </div>
        {!taskListLoading && <TaskListScrollbar scrollerRef={listRef} />}
      </div>
    </>
  );
}

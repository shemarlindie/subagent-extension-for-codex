import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { CONNECTION } from "../../../app/state/connection";
import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import {
  effectiveFilter,
  FILTER_LABELS,
  listedTask,
  projectChoices,
  scopedTasks,
  TASK_LIST_FIELDS,
  visibleTasks,
} from "../../../app/state/selectors";
import type { Filter, Task } from "../../../app/state/types";
import { Button } from "../../../shared/components/button/button";
import { LoadingSwap } from "../../../shared/components/loading-skeleton/loading-swap";
import { useListMotion } from "../../../shared/components/motion/use-list-motion";
import { animateScrollIntoView } from "../../../shared/utils/animate-scroll-into-view";
import { NewTaskRow } from "../../delegation/new-task/new-task-row";
import { projectDisplayName } from "../../projects/selectors";
import { ProjectGroups, useProjectGroups } from "./project-groups";
import { TaskListCount } from "./task-list-count";
import { TaskListScrollbar } from "./task-list-scrollbar";
import { TaskListSkeleton } from "./task-list-skeleton";
import { TaskRow } from "./task-row";
import { TaskSelectionMenu } from "./task-selection-menu";
import { useTaskSelection } from "./use-task-selection";

const EMPTY_FILTER: Record<Filter, string> = {
  all: "No tasks yet.",
  unread: "You're all caught up.",
  active: "No working tasks.",
  attention: "No tasks need attention.",
  completed: "No finished tasks.",
  failed: "No failed tasks.",
};

/**
 * Opens the focused element's context menu, or `menu`'s, on Shift+F10, which
 * Chromium on macOS ignores.
 */
function openContextMenu(
  event: ReactKeyboardEvent<HTMLElement>,
  menu: Element | null = event.target as Element,
) {
  if (event.key !== "F10" || !event.shiftKey) return;

  const { left, bottom } = (event.target as Element).getBoundingClientRect();

  event.preventDefault();

  menu?.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: left,
      clientY: bottom,
    }),
  );
}

function visibleRow(list: HTMLDivElement, id?: string) {
  if (!id) return;

  const row = list.querySelector<HTMLButtonElement>(
    `[data-task="${CSS.escape(id)}"]`,
  );

  if (!row) return;

  const { top, bottom, height } = row.getBoundingClientRect();
  const area = list.getBoundingClientRect();

  return height > 0 && top >= area.top && bottom <= area.bottom
    ? row
    : undefined;
}

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
    scopeVersion,
    panelSettings,
  } = useSnapshot(
    [
      "projects",
      "connected",
      "connection",
      "conversation",
      "taskListLoading",
      "scopeVersion",
      "panelSettings",
    ],
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

  const current = listedTask(list);

  const projectGroups = useProjectGroups(
    list.repository ? [] : tasks,
    list.search,
    current,
  );

  const shown = list.repository
    ? tasks
    : projectGroups.groups.flatMap((group) => (group.open ? group.shown : []));

  const selection = useTaskSelection(
    JSON.stringify([scopeVersion, list.search, list.filter]),
    tasks,
    shown,
  );

  const selecting = selection.ids !== undefined;
  const scopeRef = useRef<HTMLSpanElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const scrolledOnLoad = useRef(false);
  const cancelScroll = useRef<(() => void) | undefined>(undefined);

  const { anchor, exit } = selection;

  const endSelection = useCallback(() => {
    const list = listRef.current;

    if (!list?.contains(list.ownerDocument.activeElement)) {
      const row = list && visibleRow(list, anchor);

      row?.focus({ preventScroll: true });

      if (!row || row.ownerDocument.activeElement !== row) {
        scopeRef.current?.focus({ preventScroll: true });
      }
    }

    exit();
  }, [anchor, exit]);

  // Clicking blank space in the list or its header clears the selection, as in
  // Finder. Menus render in portals, so their clicks reach here from outside.
  const clearOnBlank = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (
      selecting &&
      event.target instanceof Element &&
      event.currentTarget.contains(event.target) &&
      !event.target.closest("button, a, input, [data-task]")
    ) {
      endSelection();
    }
  };

  useEffect(() => {
    if (!selecting) return;

    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        !(event.target instanceof Node)
      ) {
        return;
      }

      if (
        !listRef.current?.contains(event.target) &&
        event.target !== countRef.current
      ) {
        return;
      }

      // Escape closes the selection's context menu first.
      if (listRef.current?.hasAttribute("data-popup-open")) return;

      event.preventDefault();
      endSelection();
    };

    document.addEventListener("keydown", escape);

    return () => document.removeEventListener("keydown", escape);
  }, [selecting, endSelection]);

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
          current={task.id === current}
          pressed={selection.ids?.has(task.id)}
          disabled={selecting && selection.blocked ? true : undefined}
          onActivate={selection.clickRow}
        />
      );

      if (list.repository) return tasks.map(renderRow);

      // Across projects, each project's tasks sit under their own header.
      return (
        <ProjectGroups
          model={projectGroups}
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

  // Under Unread, the listed tasks can all be read at once. Without a search
  // to clear, this takes Clear filter's place; the All pill does the same.
  const unreadShown = filter === "unread" && tasks.some((task) => task.unread);
  const clearShown = narrowed && (!unreadShown || Boolean(list.search));

  const markAllRead = () =>
    controller.run(() => controller.taskActions.unread.markAllRead(tasks));

  return (
    <>
      <div className="list-label" onClick={clearOnBlank}>
        <span className="list-scope">
          <span id="scope" ref={scopeRef} tabIndex={-1}>
            {conversation ? "This conversation" : "All conversations"}
          </span>
          <span
            className="list-count"
            ref={countRef}
            tabIndex={-1}
            // Focus lands here after an action, so the selection's menu opens too.
            onKeyDown={
              selecting
                ? (event) => openContextMenu(event, listRef.current)
                : undefined
            }
          >
            <TaskListCount
              loading={taskListLoading}
              shown={tasks.length}
              total={total}
              narrowed={narrowed}
              selection={selection}
            />
          </span>
        </span>
        {!selecting && (unreadShown || clearShown) && (
          <span className="list-actions">
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
          </span>
        )}
      </div>
      <div className="task-list-scroll-area">
        <TaskSelectionMenu
          selection={selection}
          shown={shown.length}
          render={
            <div
              id="task-list"
              ref={listRef}
              data-row-icons={panelSettings.row_icons ? undefined : "hidden"}
              onKeyDown={openContextMenu}
              onClick={clearOnBlank}
            />
          }
          count={countRef}
        >
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
        </TaskSelectionMenu>
        {!taskListLoading && <TaskListScrollbar scrollerRef={listRef} />}
      </div>
    </>
  );
}

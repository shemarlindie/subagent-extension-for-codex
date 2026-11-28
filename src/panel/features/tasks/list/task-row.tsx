import { ContextMenu } from "@base-ui/react/context-menu";
import { memo, type MouseEvent, type SyntheticEvent } from "react";

import { archivable } from "../../../../core/shared/tasks/archive.js";
import {
  pinnedPlan,
  planProgress,
} from "../../../../core/shared/tasks/plan.js";
import { useController } from "../../../app/state/controller-context";
import { profileLabel } from "../../../app/state/selectors";
import type { Task } from "../../../app/state/types";
import { Button } from "../../../shared/components/button/button";
import { Icon } from "../../../shared/components/icons/icons";
import { reducedMotion } from "../../../shared/components/motion/motion-utils";
import { Presence } from "../../../shared/components/motion/presence";
import { TooltipWrapper } from "../../../shared/components/tooltip";
import { composerMode } from "../chat/chat-model";
import { UnreadDot } from "../unread/unread-dot";
import { rowStatus, statusTone } from "./task-status";
import { TaskStatusIcon } from "./task-status-icon";
import type { TaskRowClick } from "./use-task-selection";
import { WorkerProfileIcon } from "./worker-profile-icon";

interface TaskRowProps {
  task: Task;
  current: boolean;
  pressed?: boolean;
  disabled?: boolean;
  onActivate?: (id: string, action: TaskRowClick) => void;
  /** Runs an action that can remove the row, keeping focus in the list. */
  keepFocus?: (id: string, action: () => Promise<unknown>) => Promise<unknown>;
}

// Pixels per second a long title slides on hover or focus.
const TITLE_SLIDE_SPEED = 50;

/**
 * Times a long title's slide from its overflow, so every title slides at
 * about the same easy pace. CSS can't turn a width into a duration. Titles
 * measure when they mount, which covers rows that appear under a still
 * pointer, and again on hover or focus in case the row's width changed.
 */
function paceTitleSlide(title: HTMLElement | null) {
  const text = title?.querySelector<HTMLElement>(".row-title-text");
  if (!title || !text) return;

  const overflow = text.offsetWidth - title.clientWidth;

  // With reduced motion, CSS makes a long title jump to its end, which can
  // skip its middle, so a tooltip shows the whole title.
  const still = reducedMotion(title);
  title.title = still && overflow > 0 ? text.textContent : "";
  if (still || overflow <= 0) return;

  const seconds = Math.max(0.6, overflow / TITLE_SLIDE_SPEED);
  title.style.setProperty("--row-title-slide-duration", `${seconds}s`);

  // Measuring on hover applies the hover style first, which starts the slide
  // with the old duration, so the slide takes the new one directly.
  for (const animation of title.getAnimations({ subtree: true })) {
    if (animation instanceof CSSTransition) {
      animation.effect?.updateTiming({ duration: seconds * 1000 });
    }
  }
}

const repaceTitleSlide = (event: SyntheticEvent<HTMLElement>) =>
  paceTitleSlide(event.currentTarget.querySelector(".row-title"));

/** A task in the list with actions on right-click or long-press. */
export const TaskRow = memo(function TaskRow({
  task,
  current,
  pressed,
  disabled,
  onActivate,
  keepFocus,
}: TaskRowProps) {
  const controller = useController();

  const canArchive = archivable(task);

  const select = (event: MouseEvent<HTMLButtonElement>) => {
    if (!onActivate) {
      controller.run(() => controller.selection.select(task.id));

      return;
    }

    if (event.shiftKey) {
      onActivate(task.id, "range");
    } else if (pressed !== undefined || event.metaKey || event.ctrlKey) {
      onActivate(task.id, "toggle");
    } else {
      onActivate(task.id, "open");
    }
  };

  const toggleRead = () =>
    controller.run(() => controller.taskActions.unread.toggle(task));

  const archive = () => {
    const action = () =>
      controller.taskActions.archive.setArchived([task], true);

    controller.run(keepFocus ? () => keepFocus(task.id, action) : action);
  };

  // The container hovers and moves as one, so pointing at Archive keeps the
  // row's hover, and Archive slides with the row when the list moves.
  return (
    <ContextMenu.Root disabled={pressed !== undefined}>
      <div
        className="task-row-container"
        data-task-row={task.id}
        onPointerEnter={repaceTitleSlide}
      >
        <ContextMenu.Trigger
          render={
            <button
              className="row"
              data-task={task.id}
              data-unread={task.unread ? "" : undefined}
              aria-current={pressed === undefined ? current : undefined}
              aria-pressed={pressed}
              aria-disabled={disabled}
              onClick={select}
              onFocus={repaceTitleSlide}
            />
          }
        >
          <TaskRowContent task={task} keepSlot={canArchive} />
        </ContextMenu.Trigger>
        {pressed === undefined && canArchive && (
          <TooltipWrapper label="Archive task">
            <Button
              variant="ghost"
              className="row-archive"
              aria-description={task.title}
              onClick={archive}
            >
              <Icon name="archive" size={12} />
            </Button>
          </TooltipWrapper>
        )}
      </div>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="menu-positioner">
          <ContextMenu.Popup className="menu-popup">
            {onActivate && (
              <ContextMenu.Item
                className="menu-item"
                onClick={() => onActivate(task.id, "toggle")}
              >
                Select task
              </ContextMenu.Item>
            )}
            <ContextMenu.Item
              className="menu-item"
              data-action={task.unread ? "mark-read" : "mark-unread"}
              onClick={toggleRead}
            >
              {task.unread ? "Mark read" : "Mark unread"}
            </ContextMenu.Item>
            <ContextMenu.Item
              className="menu-item"
              data-action="archive"
              disabled={!canArchive}
              onClick={archive}
            >
              Archive
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
});

type TaskRowContentProps = Pick<TaskRowProps, "task"> & {
  /** Keeps the dot's slot when empty, for Archive to show in. */
  keepSlot: boolean;
};

// The title comes first so screen readers hear it first; CSS puts the icon
// before it. A title too long for the row scrolls to its end on hover or focus.
// The icon tells profiles apart, so the worker's name is for screen readers
// only.
function TaskRowContent({ task, keepSlot }: TaskRowContentProps) {
  const worker = profileLabel(task.worker_profile);

  return (
    <>
      <span className="row-title" ref={paceTitleSlide}>
        <span className="row-title-text">
          <span className="row-title-slide">{task.title}</span>
        </span>
      </span>
      <span className="row-worker" title={worker}>
        <WorkerProfileIcon
          profile={task.worker_profile}
          className="row-worker-icon"
        />
        <span className="visually-hidden">{worker}</span>
      </span>
      <TaskRowPlan task={task} />
      <TaskRowSignal task={task} keepSlot={keepSlot} />
      <TaskRowAsk task={task} />
    </>
  );
}

/**
 * The latest turn's question, while the task waits for its answer. The line
 * eases in and out so the row's height changes smoothly.
 */
function TaskRowAsk({ task }: Pick<TaskRowProps, "task">) {
  const { reply } = task;

  const ask =
    reply?.turn === task.turn && composerMode(task) === "idle"
      ? reply.ask
      : undefined;

  return (
    <Presence show={Boolean(ask)} as="span">
      {ask && <span className="row-ask">{ask}</span>}
    </Presence>
  );
}

/** How far the worker's plan has got, while it has steps left. */
function TaskRowPlan({ task }: Pick<TaskRowProps, "task">) {
  const plan = pinnedPlan(task.plan);
  if (!plan) return null;
  const { done, total } = planProgress(plan.steps);

  return (
    <span className="row-plan">
      <span aria-hidden="true">
        {done}/{total}
      </span>
      <span className="visually-hidden">
        Plan, {done} of {total} steps done
      </span>
    </span>
  );
}

/**
 * One dot at most: a task that needs input, then one at work, then one with
 * something unread. Screen readers hear the unread state and status whichever
 * dot shows. A row that can be archived keeps the slot for Archive, so its
 * title keeps its width while the dot fades in or out. On other rows, the
 * title takes an empty slot's space, and the slot folds in or out as a dot
 * comes or goes.
 */
function TaskRowSignal({ task, keepSlot }: TaskRowContentProps) {
  const { kind, label } = rowStatus(task);
  const quiet = statusTone(kind) === "quiet";

  const dot = quiet ? (
    task.unread && <UnreadDot />
  ) : (
    <TaskStatusIcon kind={kind} label={label} />
  );

  return (
    <>
      {task.unread && !quiet && <span className="visually-hidden">Unread</span>}
      {keepSlot ? (
        <span className="row-signal">
          <Presence show={Boolean(dot)} as="span" variant="pop">
            {dot}
          </Presence>
        </span>
      ) : (
        <Presence show={Boolean(dot)} as="span" variant="fold">
          <span className="row-signal">{dot}</span>
        </Presence>
      )}
      {quiet && <span className="visually-hidden">{label}</span>}
    </>
  );
}

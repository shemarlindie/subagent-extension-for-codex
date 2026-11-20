import { ContextMenu } from "@base-ui/react/context-menu";
import { memo, type MouseEvent } from "react";

import { archivable } from "../../../../shared/tasks/archive.js";
import { useController } from "../../../app/state/controller-context";
import { profileLabel } from "../../../app/state/selectors";
import type { Task } from "../../../app/state/types";
import { Presence } from "../../../shared/components/motion/presence";
import { UnreadDot } from "../unread/unread-dot";
import { measureRowTitle } from "./row-title-slide";
import { rowStatus } from "./task-status";
import { statusTone, TaskStatusIcon } from "./task-status-icon";
import type { TaskRowClick } from "./use-task-selection";
import { WorkerProfileIcon } from "./worker-profile-icon";

interface TaskRowProps {
  task: Task;
  current: boolean;
  pressed?: boolean;
  disabled?: boolean;
  onActivate?: (id: string, action: TaskRowClick) => void;
}

/** A task in the list with actions on right-click or long-press. */
export const TaskRow = memo(function TaskRow({
  task,
  current,
  pressed,
  disabled,
  onActivate,
}: TaskRowProps) {
  const controller = useController();

  const select = (event: MouseEvent<HTMLButtonElement>) => {
    if (!onActivate) {
      controller.run(() => controller.select(task.id));

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

  const archive = () =>
    controller.run(() =>
      controller.taskActions.archive.setArchived([task], true),
    );

  return (
    <ContextMenu.Root disabled={pressed !== undefined}>
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
            onPointerEnter={(event) => measureRowTitle(event.currentTarget)}
            onFocus={(event) => measureRowTitle(event.currentTarget)}
          />
        }
      >
        <TaskRowContent task={task} />
      </ContextMenu.Trigger>
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
              disabled={!archivable(task)}
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

type TaskRowContentProps = Pick<TaskRowProps, "task">;

// The title comes first so screen readers hear it first; CSS puts the icon
// before it. A title too long for the row scrolls to its end on hover or focus.
// The icon tells profiles apart, so the worker's name is for screen readers
// only.
function TaskRowContent({ task }: TaskRowContentProps) {
  const worker = profileLabel(task.worker_profile);

  return (
    <>
      <span className="row-title">
        <span className="row-title-text">{task.title}</span>
      </span>
      <span className="row-worker" title={worker}>
        <WorkerProfileIcon
          profile={task.worker_profile}
          size={12}
          className="row-worker-icon"
        />
        <span className="visually-hidden">{worker}</span>
      </span>
      <TaskRowSignal task={task} />
    </>
  );
}

/**
 * One dot at most: a task that needs input, then one at work, then one with
 * something unread. Screen readers hear the unread state and status whichever
 * dot shows. Without a dot, the title takes the slot's space, and the slot
 * folds in or out as a dot comes or goes.
 */
function TaskRowSignal({ task }: TaskRowContentProps) {
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
      <Presence show={Boolean(dot)} as="span" variant="fold">
        <span className="row-signal">{dot}</span>
      </Presence>
      {quiet && <span className="visually-hidden">{label}</span>}
    </>
  );
}

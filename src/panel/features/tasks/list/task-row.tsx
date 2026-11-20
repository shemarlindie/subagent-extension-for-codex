import { ContextMenu } from "@base-ui/react/context-menu";
import { memo, type MouseEvent } from "react";

import { archivable } from "../../../../shared/tasks/archive.js";
import { useController } from "../../../app/state/controller-context";
import { profileLabel, terminal } from "../../../app/state/selectors";
import type { Task } from "../../../app/state/types";
import { useNow } from "../../../shared/utils/use-now";
import { UnreadDot } from "../unread/unread-dot";
import { formatDuration, runtimeLive, taskRuntimeMs } from "./duration";
import { rowStatus } from "./task-status";
import { statusTone, TaskStatusIcon } from "./task-status-icon";
import type { TaskRowClick } from "./use-task-selection";
import { WorkerProfileIcon } from "./worker-profile-icon";

interface TaskRowProps {
  task: Task;
  current: boolean;
  pressed?: boolean;
  disabled?: boolean;
  /** Shows the task on one line: profile icon, title and status mark. */
  compact?: boolean;
  onActivate?: (id: string, action: TaskRowClick) => void;
}

/** A task in the list with actions on right-click or long-press. */
export const TaskRow = memo(function TaskRow({
  task,
  current,
  pressed,
  disabled,
  compact = false,
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
            data-compact={compact ? "" : undefined}
            aria-current={pressed === undefined ? current : undefined}
            aria-pressed={pressed}
            aria-disabled={disabled}
            onClick={select}
          />
        }
      >
        {compact ? (
          <CompactTaskRowContent task={task} />
        ) : (
          <TaskRowContent task={task} />
        )}
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

// The title comes first so screen readers hear it first; CSS puts the icon
// before it. Its tooltip shows the whole title when the row fades it out.
function CompactTaskRowContent({ task }: TaskRowContentProps) {
  const worker = profileLabel(task.worker_profile);

  return (
    <>
      <span className="row-title" title={task.title}>
        {task.title}
      </span>
      <span className="row-worker" title={worker}>
        <WorkerProfileIcon
          profile={task.worker_profile}
          size={12}
          className="row-worker-icon"
        />
        <span className="visually-hidden">{worker}</span>
      </span>
      <CompactRowSignal task={task} />
    </>
  );
}

/**
 * One dot at most: a task that needs input, then one at work, then one with
 * something unread. Screen readers hear the unread state and status whichever
 * dot shows.
 */
function CompactRowSignal({ task }: { task: Task }) {
  const quiet = statusTone(rowStatus(task).kind) === "quiet";

  return (
    <span className="row-signal">
      {task.unread &&
        (quiet ? (
          <UnreadDot />
        ) : (
          <span className="visually-hidden">Unread</span>
        ))}
      <TaskRowStatus task={task} />
    </span>
  );
}

// Rows show a dot only for work and input. Otherwise the runtime or label says
// enough, so the status is for screen readers.
function TaskRowStatus({ task }: { task: Task }) {
  const { kind, label } = rowStatus(task);

  return statusTone(kind) === "quiet" ? (
    <span className="visually-hidden">{label}</span>
  ) : (
    <TaskStatusIcon kind={kind} label={label} />
  );
}

function TaskRowRuntime({ task }: { task: Task }) {
  const status = rowStatus(task);

  const activityLabel =
    (task.status === "running" &&
      (status.kind === "failed" ||
        status.kind === "paused" ||
        status.kind === "input")) ||
    Boolean(task.pending_input);

  const live = runtimeLive(task) && !activityLabel;
  const now = useNow(live);
  const runtime = taskRuntimeMs(task, now);

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

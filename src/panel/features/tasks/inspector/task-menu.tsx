import { Menu } from "@base-ui/react/menu";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { buttonClass } from "../../../shared/components/button/button";
import { Icon } from "../../../shared/components/icons/icons";
import { TooltipWrapper } from "../../../shared/components/tooltip";
import { canToggleArchive } from "../archive/archive-actions";

type TaskMenuProps = { task: Task };

function handoffMenuLabel(canSend: boolean, canCopy: boolean) {
  if (canSend) return "Bring to Codex";

  return canCopy ? "Copy for Codex" : "Prepare message for Codex";
}

/** Task actions beside the open task's title and status. */
export function TaskMenu({ task }: TaskMenuProps) {
  const controller = useController(),
    state = useSnapshot(),
    handoffLabel = handoffMenuLabel(
      state.host.canSend,
      !controller.transport.embedded,
    );

  const toggleRead = () =>
    controller.run(() => controller.taskActions.unread.toggle(task));

  const toggleArchive = () =>
    controller.run(() => controller.taskActions.archive.toggle(task));

  return (
    <Menu.Root>
      <TooltipWrapper label="Task actions">
        <Menu.Trigger
          id="task-menu"
          className={buttonClass("ghost", {
            className: "toolbar-icon-button task-menu",
          })}
          aria-label="Task actions"
        >
          <Icon name="more-circle" size={14} />
        </Menu.Trigger>
      </TooltipWrapper>
      <Menu.Portal>
        <Menu.Positioner className="menu-positioner" align="end" sideOffset={4}>
          <Menu.Popup className="menu-popup">
            <Menu.Item
              className="menu-item"
              data-action={task.unread ? "mark-read" : "mark-unread"}
              onClick={toggleRead}
            >
              {task.unread ? "Mark read" : "Mark unread"}
            </Menu.Item>
            <Menu.Item
              className="menu-item"
              data-action={task.archived_at ? "unarchive" : "archive"}
              disabled={!canToggleArchive(task)}
              onClick={toggleArchive}
            >
              {task.archived_at ? "Unarchive" : "Archive"}
            </Menu.Item>
            <Menu.Item
              className="menu-item"
              data-action="handoff"
              disabled={state.busy}
              onClick={() => controller.open({ kind: "handoff", task })}
            >
              {handoffLabel}
            </Menu.Item>
            <Menu.Item
              className="menu-item"
              data-action="delete"
              disabled={state.busy}
              onClick={() => controller.open({ kind: "delete", task })}
            >
              Delete task
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

import { Menu } from "@base-ui/react/menu";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { buttonClass } from "../../../shared/components/button/button";
import { Icon } from "../../../shared/components/icons/icons";
import { TooltipWrapper } from "../../../shared/components/tooltip";

type TaskMenuProps = { task: Task };

/** More actions for the open task, beside its title and status. */
export function TaskMenu({ task }: TaskMenuProps) {
  const controller = useController(),
    state = useSnapshot(),
    handoffLabel = state.host.canSend
      ? "Bring to Codex"
      : !controller.transport.embedded
        ? "Copy for Codex"
        : "Prepare handoff";

  return (
    <Menu.Root>
      <TooltipWrapper label="More actions">
        <Menu.Trigger
          id="task-menu"
          className={buttonClass("ghost", {
            className: "toolbar-icon-button task-menu",
          })}
          aria-label="More task actions"
        >
          <Icon name="more-horizontal" size={14} />
        </Menu.Trigger>
      </TooltipWrapper>
      <Menu.Portal>
        <Menu.Positioner className="menu-positioner" align="end" sideOffset={4}>
          <Menu.Popup className="menu-popup">
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

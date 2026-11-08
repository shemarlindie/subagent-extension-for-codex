import { Menu } from "@base-ui/react/menu";

import { useController } from "../../../app/state/controller-context";
import { Button, buttonClass } from "../../../shared/components/button/button";
import { Chevron } from "../../../shared/components/chevron";

type NewTaskButtonProps = { disabled: boolean };

/**
 * The header's split button: **New task** opens the composer, and its
 * menu offers **Advanced task…**, the dialog with every option.
 */
export function NewTaskButton({ disabled }: NewTaskButtonProps) {
  const controller = useController();

  return (
    <div id="new-task" className="split-button" role="group">
      <Button
        variant="primary"
        className="split-button-main"
        disabled={disabled}
        onClick={() => controller.newTasks.open()}
      >
        New task
      </Button>
      <Menu.Root>
        <Menu.Trigger
          className={buttonClass("primary", {
            className: "split-button-menu",
          })}
          aria-label="More ways to start a task"
          disabled={disabled}
        >
          <Chevron />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            className="menu-positioner"
            align="end"
            sideOffset={4}
          >
            <Menu.Popup className="menu-popup">
              <Menu.Item
                className="menu-item new-task-menu-item"
                onClick={() => controller.run(() => controller.delegate())}
              >
                <span className="select-item-text">
                  <span>Advanced task…</span>
                  <span className="select-item-description">
                    Workspace, permissions and budgets
                  </span>
                </span>
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

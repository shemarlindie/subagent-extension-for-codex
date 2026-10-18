import { Menu } from "@base-ui/react/menu";

import { archivable } from "../../../../shared/tasks/archive.js";
import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";
import { buttonClass } from "../../../shared/components/button/button";
import { Icon } from "../../../shared/components/icons/icons";

type ProjectArchiveMenuProps = {
  repository: string;
  name: string;
};

/**
 * Archives a project's completed tasks, or all its stopped ones, from its
 * header in the task list. It acts on every task of the project in the panel's
 * scope, whatever the search or filter shows.
 */
export function ProjectArchiveMenu({
  repository,
  name,
}: ProjectArchiveMenuProps) {
  const controller = useController(),
    state = useSnapshot();

  const stopped = state.tasks.filter(
    (task) =>
      task.repository === repository && !task.archived_at && archivable(task),
  );

  const completed = stopped.filter((task) => task.status === "completed");

  const archive = (tasks: Task[]) =>
    controller.run(() =>
      controller.taskActions.archive.setArchived(tasks, true),
    );

  return (
    <Menu.Root>
      <Menu.Trigger
        className={buttonClass("ghost", {
          className: "task-group-menu",
        })}
        aria-label={`Actions for ${name}`}
      >
        <Icon name="more-horizontal" size={12} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="menu-positioner" align="end" sideOffset={2}>
          <Menu.Popup className="menu-popup">
            <Menu.Item
              className="menu-item"
              data-action="archive-completed"
              disabled={!completed.length}
              onClick={() => archive(completed)}
            >
              Archive completed
            </Menu.Item>
            <Menu.Item
              className="menu-item"
              data-action="archive-all"
              disabled={!stopped.length}
              onClick={() => archive(stopped)}
            >
              Archive all
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

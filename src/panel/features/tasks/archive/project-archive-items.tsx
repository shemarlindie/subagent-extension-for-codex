import { Menu } from "@base-ui/react/menu";

import { archivable } from "../../../../shared/tasks/archive.js";
import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import type { Task } from "../../../app/state/types";

type ProjectArchiveItemsProps = { repository: string };

/**
 * Archives a project's completed tasks, or all its stopped ones, from its
 * header menu in the task list. It acts on every task of the project in the
 * panel's scope, whatever the search or filter shows.
 */
export function ProjectArchiveItems({ repository }: ProjectArchiveItemsProps) {
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
    <>
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
    </>
  );
}

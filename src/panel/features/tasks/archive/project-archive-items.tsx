import { Menu } from "@base-ui/react/menu";

import { archivable } from "../../../../shared/tasks/archive.js";
import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { projectTaskArgs } from "../../../app/state/task-list-read";
import type { Task, TaskList } from "../../../app/state/types";

type ProjectArchiveItemsProps = { repository: string };

/**
 * Archives a project's completed tasks, or all its stopped ones, from its
 * header menu in the task list. It acts on every task of the project in the
 * panel's scope, whatever the search or filter shows, reading first the read
 * completed tasks the list left out.
 */
export function ProjectArchiveItems({ repository }: ProjectArchiveItemsProps) {
  const controller = useController();

  const { tasks, readCompleted } = useSnapshot(["tasks", "readCompleted"]);

  const unloaded = readCompleted?.[repository] ?? 0;

  const stoppedIn = (tasks: Task[]) =>
    tasks.filter(
      (task) =>
        task.repository === repository && !task.archived_at && archivable(task),
    );

  const stopped = stoppedIn(tasks);

  const completed = (tasks: Task[]) =>
    tasks.filter((task) => task.status === "completed");

  const archive = (pick: (tasks: Task[]) => Task[]) =>
    controller.run(async () => {
      const candidates = unloaded
        ? (
            await controller.tool<TaskList>(
              "app_list_tasks",
              projectTaskArgs(controller.getSnapshot(), repository),
            )
          ).tasks
        : tasks;

      await controller.taskActions.archive.setArchived(
        pick(stoppedIn(candidates)),
        true,
      );
    });

  return (
    <>
      <Menu.Item
        className="menu-item"
        data-action="archive-completed"
        disabled={!completed(stopped).length && !unloaded}
        onClick={() => archive(completed)}
      >
        Archive completed
      </Menu.Item>
      <Menu.Item
        className="menu-item"
        data-action="archive-all"
        disabled={!stopped.length && !unloaded}
        onClick={() => archive((tasks) => tasks)}
      >
        Archive all
      </Menu.Item>
    </>
  );
}

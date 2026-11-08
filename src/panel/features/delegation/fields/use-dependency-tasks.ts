import { useEffect, useState } from "react";

import {
  useController,
  useSnapshot,
} from "../../../app/state/controller-context";
import { projectTaskArgs } from "../../../app/state/task-list-read";
import type { Task, TaskList } from "../../../app/state/types";

/**
 * The tasks a new task in `repository` can wait for: the listed tasks, plus
 * the read completed ones the list left out, read once for the project.
 * Dependencies carry their results, so finished tasks stay useful options.
 */
export function useDependencyTasks(tasks: Task[], repository: string) {
  const controller = useController(),
    { conversation, readCompleted } = useSnapshot(),
    unloaded = Boolean(repository && readCompleted?.[repository]),
    [read, setRead] = useState<{ repository: string; tasks: Task[] }>();

  useEffect(() => {
    if (!unloaded) return;
    let current = true;

    controller.run(async () => {
      const list = await controller.tool<TaskList>(
        "app_list_tasks",
        projectTaskArgs({ conversation }, repository),
      );

      if (current) setRead({ repository, tasks: list.tasks });
    });

    return () => {
      current = false;
    };
  }, [controller, conversation, repository, unloaded]);

  const extra = read && read.repository === repository ? read.tasks : undefined;

  const options = [
    ...tasks,
    ...(extra ?? []).filter((task) => !tasks.some((t) => t.id === task.id)),
  ]
    .filter((task) => task.repository === repository && !task.archived_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return { options, loading: unloaded && !extra };
}

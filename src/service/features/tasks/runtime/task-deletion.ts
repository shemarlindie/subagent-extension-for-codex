import type { Task } from "../../../../shared/tasks/model.js";

/**
 * Orders tasks so dependents come before their dependencies, so cleanup
 * never leaves a task without its prerequisites.
 */
export function deletionOrder(tasks: Task[]) {
  const ordered: Task[] = [];
  const remaining = [...tasks];

  while (remaining.length) {
    const index = remaining.findIndex(
      (task) => !remaining.some((other) => other.depends_on.includes(task.id)),
    );

    if (index < 0) {
      throw new Error(
        "Project tasks have circular dependencies. Keep task data and resolve them first.",
      );
    }

    ordered.push(...remaining.splice(index, 1));
  }

  return ordered;
}

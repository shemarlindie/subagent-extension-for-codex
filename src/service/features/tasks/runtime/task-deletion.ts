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

/**
 * Orders tasks for deletion. A task outside them that depends on one of them
 * stops the deletion, since a follow-up can still resume its dependency.
 */
export function deletionBatch(owned: Task[], batch: Task[]) {
  const ids = new Set(batch.map((task) => task.id));

  const dependent = owned.find(
    (task) => !ids.has(task.id) && task.depends_on.some((id) => ids.has(id)),
  );

  if (dependent) {
    throw new Error(
      `Task ${dependent.id} depends on this task. Delete it first.`,
    );
  }

  return deletionOrder(batch);
}

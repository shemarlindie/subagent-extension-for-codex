import { showsReadCompleted } from "./selectors";
import type { Snapshot, Task } from "./types";

/**
 * The `app_list_tasks` arguments for the panel's list. It leaves archived
 * tasks out, except the open one and one a restored URL opens.
 */
export function taskListArgs(state: Snapshot, restored?: string) {
  const include = new Set([state.selected, restored]);

  return {
    conversation_id: state.conversation ?? null,
    ...(state.repository ? { repository: state.repository } : {}),
    include: [...include].filter(Boolean),
    include_read_completed: showsReadCompleted(state),
  };
}

/** The `app_list_tasks` arguments for every unarchived task of a project in the panel's scope. */
export const projectTaskArgs = (
  state: Pick<Snapshot, "conversation">,
  repository: string,
) => ({
  conversation_id: state.conversation ?? null,
  repository,
  include_read_completed: true,
});

/**
 * Whether a list read lacks a task selected after it began, which it must
 * not drop.
 */
export const lacksNewSelection = (
  args: { include: unknown[] },
  list: { tasks: Task[] },
  selected?: string,
) =>
  Boolean(selected) &&
  !args.include.includes(selected) &&
  !list.tasks.some((task) => task.id === selected);

/** Read completed task counts a list read left out, or none when it left none out. */
export function unloadedCounts(counts: unknown) {
  if (!counts || typeof counts !== "object") return undefined;

  const entries = Object.entries(counts).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === "number" && entry[1] > 0,
  );

  return entries.length ? Object.fromEntries(entries) : undefined;
}

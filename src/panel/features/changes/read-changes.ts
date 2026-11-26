import type { Task } from "../tasks/types";
import type { ChangeCounts, ChangedFileContent } from "./types";

/** What a task's changes depend on: a new status or turn reloads them. */
export const changesKey = (task: Task) => `${task.status}:${task.turn}`;

/** Whether a task's change read, full or counts, needs reading. */
export function changesStale(
  state: { task: string; key: string; loading: boolean } | undefined,
  task: Task,
) {
  return (
    !state ||
    state.task !== task.id ||
    (!state.loading && state.key !== changesKey(task))
  );
}

/** "+12 −3, 4 files" */
export function changesSummary({
  additions,
  deletions,
  files,
}: Pick<ChangeCounts, "additions" | "deletions" | "files">) {
  return `+${additions} −${deletions}, ${files} ${files === 1 ? "file" : "files"}`;
}

type ReadFilePart = (
  args: Record<string, unknown>,
) => Promise<ChangedFileContent>;

/** Reads every part of a changed file and joins them. */
export async function readChangedFile(
  taskId: string,
  path: string,
  read: ReadFilePart,
) {
  let part = await read({ task_id: taskId, path });
  let content = part.content ?? "";

  while (part.next_cursor) {
    part = await read({ task_id: taskId, path, cursor: part.next_cursor });
    content += part.content ?? "";
  }

  const { next_cursor: _, ...last } = part;

  return { ...last, ...(last.state === "present" ? { content } : {}) };
}

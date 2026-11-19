import { chunks } from "../../../shared/utils/chunks";
import { errorMessage } from "../../../shared/utils/error-message";

/** Maximum number of task IDs accepted by the panel's batch tools. */
export const TASK_BATCH_LIMIT = 1000;

export type TaskBatchFailure = { count: number; error: unknown };

/** Describes targets that could not be changed. */
export function taskBatchWarning(skipped: number, failure?: TaskBatchFailure) {
  const parts: string[] = [];
  if (skipped) parts.push(`${skipped} skipped.`);

  if (failure) {
    parts.push(`${failure.count} failed. ${errorMessage(failure.error)}`);
  }

  return parts.join(" ");
}

/** Runs one request at a time and preserves the outcome of each batch. */
export async function settleTaskBatches<T, Result>(
  items: T[],
  size: number,
  apply: (batch: T[]) => Promise<Result>,
) {
  const changed: Result[] = [];
  const failed: T[] = [];
  let firstError: unknown;

  for (const batch of chunks(items, size)) {
    try {
      changed.push(await apply(batch));
    } catch (error) {
      if (!failed.length) firstError = error;
      failed.push(...batch);
    }
  }

  return {
    changed,
    failed,
    failure: failed.length
      ? { count: failed.length, error: firstError }
      : undefined,
  };
}

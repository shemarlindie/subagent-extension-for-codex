import { reuseUnchanged } from "../../shared/utils/reuse-unchanged";
import type { Snapshot } from "./types";

/** Read data that each refresh rebuilds, even when nothing changed. */
const READ_FIELDS = [
  "tasks",
  "readCompleted",
  "workers",
  "projects",
  "events",
  "droppedEvents",
  "chat",
  "pendingUpdates",
] satisfies (keyof Snapshot)[];

/**
 * Applies a patch, keeping the references of read data that holds the same
 * contents, so components selecting it skip rendering. Returns `state` itself
 * when the patch changes nothing.
 */
export function patchState(state: Snapshot, patch: Partial<Snapshot>) {
  const next = { ...state, ...patch };

  for (const field of READ_FIELDS) {
    if (field in patch) {
      Object.assign(next, {
        [field]: reuseUnchanged(state[field], next[field]),
      });
    }
  }

  // Approving or removing a project changes what its folder's read finds, and
  // new global workers, such as Claude becoming ready, call for a reread.
  if (next.projects !== state.projects || next.workers !== state.workers) {
    next.projectWorkers = {};
  }

  const fields = Object.keys(patch) as (keyof Snapshot)[];

  return fields.some((field) => !Object.is(next[field], state[field]))
    ? next
    : state;
}

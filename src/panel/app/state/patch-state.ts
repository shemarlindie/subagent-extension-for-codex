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
] satisfies (keyof Snapshot)[];

/**
 * Applies a patch, keeping the references of read data that holds the same
 * contents, so components selecting it skip rendering.
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

  return next;
}

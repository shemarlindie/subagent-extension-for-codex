import { useCallback } from "react";

import { useController } from "../../app/state/controller-context";
import type { TaskSessionState } from "../../app/state/session/session-state";
import { useSessionState } from "../../app/state/session/use-session-state";
import type { ChangedFileEntry } from "./changed-files";

const selectViewed = (state: TaskSessionState) => state.viewedChanges;

/** Whether the file was marked viewed and hasn't changed since. */
export function isViewed(
  viewed: ReadonlyMap<string, string>,
  entry: ChangedFileEntry,
) {
  return viewed.get(entry.file.path) === entry.signature;
}

/** Whether the file was marked viewed but has changed since. */
export function changedSinceViewed(
  viewed: ReadonlyMap<string, string>,
  entry: ChangedFileEntry,
) {
  const signature = viewed.get(entry.file.path);

  return signature !== undefined && signature !== entry.signature;
}

/**
 * The task's viewed files, kept for the panel session. Marking a file viewed
 * collapses it in the Changes list; unmarking opens it again.
 */
export function useViewedFiles(task: string) {
  const { session } = useController(),
    [viewed, update] = useSessionState("task", task, selectViewed);

  const setViewed = useCallback(
    (entry: ChangedFileEntry, value: boolean) => {
      const state = session.get("task", task),
        next = new Map(state.viewedChanges),
        { path } = entry.file;

      if (value) {
        next.set(path, entry.signature);
        // Collapsed while viewed; if it changes later, it opens as unread.
        state.reading.changes.open.delete(path);
      } else {
        next.delete(path);
        state.reading.changes.open.set(path, true);
      }

      update({ viewedChanges: next });
    },
    [session, task, update],
  );

  return [viewed, setViewed] as const;
}

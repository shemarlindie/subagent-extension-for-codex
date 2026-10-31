import { useCallback } from "react";

import { useController } from "../../app/state/controller-context";
import type {
  SessionStateStore,
  TaskSessionState,
} from "../../app/state/session/session-state";
import { useSessionState } from "../../app/state/session/use-session-state";
import { quote, taskView } from "../../app/state/undo-history";
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

/** The first file not yet viewed, or the first file once all are. */
export function firstUnviewed(
  viewed: ReadonlyMap<string, string>,
  entries: ChangedFileEntry[],
) {
  return entries.find((entry) => !isViewed(viewed, entry)) ?? entries.at(0);
}

/**
 * The next file not yet viewed after `from`, wrapping to the start, or none
 * once every other file is viewed.
 */
export function nextUnviewed(
  viewed: ReadonlyMap<string, string>,
  entries: ChangedFileEntry[],
  from: ChangedFileEntry,
) {
  const index = entries.indexOf(from),
    rest = [...entries.slice(index + 1), ...entries.slice(0, index)];

  return rest.find((entry) => !isViewed(viewed, entry));
}

/** A file's viewed signature and whether it was opened, as Changes keeps them. */
type FileMark = { signature?: string; open?: boolean };

/** Sets a file's mark in the task's session memory. */
function setMark(
  session: SessionStateStore,
  task: string,
  path: string,
  mark: FileMark,
) {
  const state = session.get("task", task),
    next = new Map(state.viewedChanges),
    { open } = state.reading.changes;

  if (mark.signature === undefined) next.delete(path);
  else next.set(path, mark.signature);
  if (mark.open === undefined) open.delete(path);
  else open.set(path, mark.open);

  session.update("task", task, { viewedChanges: next });
}

/**
 * The task's viewed files, kept for the panel session. Marking a file viewed
 * collapses it in the Changes list, and unmarking opens it again. Undo puts back
 * how the file was before.
 */
export function useViewedFiles(task: string) {
  const { session, undo } = useController(),
    [viewed] = useSessionState("task", task, selectViewed);

  const setViewed = useCallback(
    (entry: ChangedFileEntry, value: boolean) => {
      const state = session.get("task", task),
        { path } = entry.file,
        name = path.split("/").at(-1) ?? path;

      const before: FileMark = {
        signature: state.viewedChanges.get(path),
        open: state.reading.changes.open.get(path),
      };

      // Collapsed while viewed. If it changes later, it opens as unread.
      const after: FileMark = value
        ? { signature: entry.signature }
        : { open: true };

      setMark(session, task, path, after);

      undo.record({
        label: `Marked ${quote(name)} ${value ? "viewed" : "not viewed"}`,
        view: taskView(task, "changes"),
        undo: async () => setMark(session, task, path, before),
        redo: async () => setMark(session, task, path, after),
      });
    },
    [session, task, undo],
  );

  return [viewed, setViewed] as const;
}

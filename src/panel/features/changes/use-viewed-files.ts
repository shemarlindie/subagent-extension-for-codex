import { useCallback } from "react";

import { useController } from "../../app/state/controller-context";
import type {
  SessionStateStore,
  TaskSessionState,
} from "../../app/state/session/session-state";
import { useSessionState } from "../../app/state/session/use-session-state";
import { quote, taskView } from "../../app/state/undo-history";
import type { ListedChange } from "./types";

const selectViewed = (state: TaskSessionState) => state.viewedChanges;

/** Whether the file was marked viewed and hasn't changed since. */
export function isViewed(
  viewed: ReadonlyMap<string, string>,
  file: ListedChange,
) {
  return viewed.get(file.path) === file.signature;
}

/** Whether the file was marked viewed but has changed since. */
export function changedSinceViewed(
  viewed: ReadonlyMap<string, string>,
  file: ListedChange,
) {
  const signature = viewed.get(file.path);

  return signature !== undefined && signature !== file.signature;
}

/** The first file not yet viewed, or the first file once all are. */
export function firstUnviewed(
  viewed: ReadonlyMap<string, string>,
  files: ListedChange[],
) {
  return files.find((file) => !isViewed(viewed, file)) ?? files.at(0);
}

/**
 * The next file not yet viewed after `from`, wrapping to the start, or none
 * once every other file is viewed.
 */
export function nextUnviewed(
  viewed: ReadonlyMap<string, string>,
  files: ListedChange[],
  from: ListedChange,
) {
  const index = files.indexOf(from);
  const rest = [...files.slice(index + 1), ...files.slice(0, index)];

  return rest.find((file) => !isViewed(viewed, file));
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
  const state = session.get("task", task);
  const next = new Map(state.viewedChanges);
  const { open } = state.reading.changes;

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
  const { session, undo } = useController();
  const [viewed] = useSessionState("task", task, selectViewed);

  const setViewed = useCallback(
    (file: ListedChange, value: boolean) => {
      const state = session.get("task", task);
      const { path } = file;
      const name = path.split("/").at(-1) ?? path;

      const before: FileMark = {
        signature: state.viewedChanges.get(path),
        open: state.reading.changes.open.get(path),
      };

      // Collapsed while viewed. If it changes later, it opens as unread.
      const after: FileMark = value
        ? { signature: file.signature }
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

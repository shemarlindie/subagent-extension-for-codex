import type { UndoEntry, UndoRecorder } from "./undo-history";

/**
 * A recorder that collects entries the way the history keeps them: a change
 * counts once it finishes, if it changed anything. Changes start at once.
 */
export function undoRecorder() {
  const entries: UndoEntry[] = [];

  const recorder: UndoRecorder = {
    record: (entry) => {
      entries.push(entry);
    },
    change: async (start, describe) => {
      const value = await start();
      const entry = describe(value);
      if (entry) entries.push(entry);

      return value;
    },
  };

  return { recorder, entries };
}

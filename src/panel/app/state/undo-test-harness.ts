import type { UndoEntry, UndoRecorder } from "./undo-history";

/**
 * A recorder that collects entries the way the history keeps them: tracked
 * changes count at once and drop out when their action fails.
 */
export function undoRecorder() {
  const entries: UndoEntry[] = [];

  const recorder: UndoRecorder = {
    record: (entry) => {
      entries.push(entry);
    },
    track: (action, entry, happened = () => true) => {
      entries.push(entry);

      void action
        .then(happened, () => false)
        .then((ok) => {
          if (!ok) entries.splice(entries.indexOf(entry), 1);
        });
    },
  };

  return { recorder, entries };
}

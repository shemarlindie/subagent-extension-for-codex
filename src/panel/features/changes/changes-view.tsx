import { useController } from "../../app/state/controller-context";
import type { Task } from "../tasks/types";
import { ChangedFileSection } from "./changed-file-section";
import { changedFileEntries, opensByDefault } from "./changed-files";
import type { ChangesReading } from "./changes-reading";
import type { Changes } from "./types";
import {
  changedSinceViewed,
  isViewed,
  useViewedFiles,
} from "./use-viewed-files";

type ChangesViewProps = {
  task: Task;
  changes: Changes;
  /** Remembers which files the reader opened or closed. */
  reading: ChangesReading;
};

/** Every changed file's diff, in Git's order, each collapsible. */
export function ChangesView({ task, changes, reading }: ChangesViewProps) {
  const controller = useController(),
    [viewed, setViewed] = useViewedFiles(task.id),
    entries = changedFileEntries(changes);

  return (
    <div className="diff-view">
      {entries.map((entry, index) => {
        const { path } = entry.file;

        return (
          <ChangedFileSection
            key={path}
            entry={entry}
            remembered={reading.open.get(path)}
            openByDefault={opensByDefault(entries, index)}
            viewed={isViewed(viewed, entry)}
            changedSinceViewed={changedSinceViewed(viewed, entry)}
            onOpenChange={(open) => reading.open.set(path, open)}
            onViewedChange={(value) => setViewed(entry, value)}
            onPreview={() => controller.open({ kind: "file", task, path })}
          />
        );
      })}
    </div>
  );
}

import { useCallback, useRef, useState } from "react";

import { useController } from "../../app/state/controller-context";
import { scrollContainer } from "../../shared/utils/scroll-container";
import type { Task } from "../tasks/types";
import { ChangedFileNavigator } from "./changed-file-navigator";
import { ChangedFileSection } from "./changed-file-section";
import { changedFileEntries, opensByDefault } from "./changed-files";
import {
  type ChangesReading,
  FILE_ATTRIBUTE,
  measurePosition,
} from "./changes-reading";
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
  activePath?: string;
};

/** A file the reader picked in the file tree, counted so picking it again reveals it again. */
type Reveal = { path: string; count: number };

/** Every changed file's diff, in Git's order, each collapsible. */
export function ChangesView({
  task,
  changes,
  reading,
  activePath,
}: ChangesViewProps) {
  const controller = useController(),
    [viewed, setViewed] = useViewedFiles(task.id),
    entries = changedFileEntries(changes),
    listRef = useRef<HTMLDivElement>(null),
    positionedReveal = useRef<Reveal>(undefined),
    [reveal, setReveal] = useState<Reveal>();

  /** Opens a file the reader picked in the tree, and scrolls to it below. */
  function revealFile(path: string) {
    reading.open.set(path, true);
    setReveal((previous) => ({ path, count: (previous?.count ?? 0) + 1 }));
  }

  const scrollToRevealed = useCallback(() => {
    const list = listRef.current;
    if (!reveal || !list || positionedReveal.current === reveal) return;

    const file = list.querySelector<HTMLElement>(
        `[${FILE_ATTRIBUTE}="${CSS.escape(reveal.path)}"]`,
      ),
      container = scrollContainer(list);

    // Move only the Changes scroller, leaving the floating navigator in place.
    if (file) {
      container.scrollTop +=
        file.getBoundingClientRect().top -
        container.getBoundingClientRect().top;

      // A pending layout restore must use the reader's new destination too.
      reading.position = measurePosition(list, container);
      positionedReveal.current = reveal;
    }
  }, [reading, reveal]);

  return (
    <div className="changes-files" ref={listRef}>
      {entries.length > 1 && (
        <ChangedFileNavigator
          entries={entries}
          viewed={viewed}
          activePath={
            entries.find((entry) => entry.file.path === activePath)?.file
              .path ?? entries[0]!.file.path
          }
          onSelect={revealFile}
        />
      )}
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
              revealed={reveal?.path === path ? reveal.count : undefined}
              onContentReady={
                reveal?.path === path ? scrollToRevealed : undefined
              }
              onViewedChange={(value) => setViewed(entry, value)}
              onPreview={() => controller.open({ kind: "file", task, path })}
            />
          );
        })}
      </div>
    </div>
  );
}

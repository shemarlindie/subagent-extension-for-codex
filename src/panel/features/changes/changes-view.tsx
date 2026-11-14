import { useCallback, useRef, useState } from "react";

import { useController } from "../../app/state/controller-context";
import { findTask } from "../../app/state/selectors";
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
  const controller = useController();
  const [viewed, setViewed] = useViewedFiles(task.id);
  const entries = changedFileEntries(changes);
  const listRef = useRef<HTMLDivElement>(null);
  const diffsRef = useRef<HTMLDivElement>(null);
  const positionedReveal = useRef<Reveal>(undefined);
  const [reveal, setReveal] = useState<Reveal>();

  const taskId = task.id;

  // Stable, so a change to one file renders only that file's section.
  const openChange = useCallback(
    (path: string, open: boolean) => reading.open.set(path, open),
    [reading],
  );

  const preview = useCallback(
    (path: string) => {
      const current = findTask(controller.getSnapshot(), taskId);
      if (current) controller.open({ kind: "file", task: current, path });
    },
    [controller, taskId],
  );

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
    );

    const container = scrollContainer(list);

    // Move only the Changes scroller, leaving the floating navigator in place.
    if (file) {
      const offset =
        file.getBoundingClientRect().top -
        container.getBoundingClientRect().top;

      const diffs = diffsRef.current;

      const shortfall =
        container.scrollTop +
        offset +
        container.clientHeight -
        container.scrollHeight;

      // A file near the end can't reach the top, so it would stay under the
      // open navigator and the file above would read as current. Add space
      // after the last file so it can.
      if (diffs && shortfall > 0) {
        diffs.style.paddingBottom = `${(parseFloat(diffs.style.paddingBottom) || 0) + shortfall}px`;
      }

      container.scrollTop += offset;

      // A pending layout restore must use the reader's new destination too.
      reading.position = measurePosition(list, container);
      positionedReveal.current = reveal;
    }
  }, [reading, reveal]);

  const [first] = entries;

  return (
    <div className="changes-files" ref={listRef}>
      {first && entries.length > 1 && (
        <ChangedFileNavigator
          entries={entries}
          viewed={viewed}
          activePath={
            entries.find((entry) => entry.file.path === activePath)?.file
              .path ?? first.file.path
          }
          onSelect={revealFile}
        />
      )}
      <div className="diff-view" ref={diffsRef}>
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
              onOpenChange={openChange}
              revealed={reveal?.path === path ? reveal.count : undefined}
              onContentReady={
                reveal?.path === path ? scrollToRevealed : undefined
              }
              onViewedChange={setViewed}
              onPreview={preview}
            />
          );
        })}
      </div>
    </div>
  );
}

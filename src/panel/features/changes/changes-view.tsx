import { imageMime } from "../../../shared/workspaces/changes";
import { useController } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { Icon } from "../../shared/components/icons/icons";
import { formatBytes } from "../../shared/utils/format";
import { DiffFile } from "../file-preview/diff/diff-file";
import type { Task } from "../tasks/types";
import { changedFileEntries } from "./changed-files";
import { type ChangesReading, FILE_ATTRIBUTE } from "./changes-reading";
import type { ChangedFile, Changes } from "./types";

/** Files start collapsed past this many, so a long list stays scannable. */
const OPEN_FILES = 8;

type ChangesViewProps = {
  task: Task;
  changes: Changes;
  /** Remembers which files the reader opened or closed. */
  reading: ChangesReading;
};

/** A binary file has no lines to show; an image can still be previewed. */
function binaryNote(file: ChangedFile) {
  return file.size === undefined
    ? "Binary file changed"
    : `Binary file changed · ${formatBytes(file.size)}`;
}

const previewable = (file: ChangedFile) =>
  !file.binary || Boolean(imageMime(file.path));

/** Every changed file's diff, in Git's order, each collapsible. */
export function ChangesView({ task, changes, reading }: ChangesViewProps) {
  const controller = useController(),
    entries = changedFileEntries(changes);

  return (
    <div className="diff-view">
      {entries.map(({ file: changed, diff, missing }) => (
        <DiffFile
          key={changed.path}
          // Names the file, so the tab can return to it.
          {...{ [FILE_ATTRIBUTE]: changed.path }}
          file={diff}
          initiallyOpen={
            reading.open.get(changed.path) ?? entries.length <= OPEN_FILES
          }
          onOpenChange={(open) => reading.open.set(changed.path, open)}
          emptyNote={
            changed.binary
              ? binaryNote(changed)
              : missing
                ? "Diff unavailable"
                : "No content changes"
          }
          actions={
            previewable(changed) && (
              <Button
                variant="ghost"
                className="diff-preview"
                aria-label={`Preview ${changed.path}`}
                onClick={() =>
                  controller.open({ kind: "file", task, path: changed.path })
                }
              >
                <Icon name="eye" size={14} />
                Preview
              </Button>
            )
          }
        />
      ))}
    </div>
  );
}

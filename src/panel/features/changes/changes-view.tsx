import { useMemo } from "react";

import { imageMime } from "../../../shared/workspaces/changes";
import { useController } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { Icon } from "../../shared/components/icons/icons";
import { formatBytes } from "../../shared/utils/format";
import { DiffFile } from "../file-preview/diff/diff-file";
import { parseDiffFiles } from "../file-preview/file-format";
import type { Task } from "../tasks/types";
import type { ChangedFile, Changes } from "./types";

/** Files start collapsed past this many, so a long list stays scannable. */
const OPEN_FILES = 8;

type ChangesViewProps = {
  task: Task;
  changes: Changes;
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
export function ChangesView({ task, changes }: ChangesViewProps) {
  const controller = useController(),
    files = useMemo(() => parseDiffFiles(changes.diff), [changes.diff]);

  return (
    <div className="diff-view">
      {files.map((file, index) => {
        // Git lists files in the same order in the diff and the file list.
        const changed = changes.files[index];

        return (
          <DiffFile
            key={changed?.path ?? index}
            file={file}
            initiallyOpen={files.length <= OPEN_FILES}
            emptyNote={
              changed?.binary ? binaryNote(changed) : "No content changes"
            }
            actions={
              changed &&
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
        );
      })}
    </div>
  );
}

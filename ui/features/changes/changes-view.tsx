import { useMemo } from "react";

import { DiffFile } from "../file-preview/components/diff-file";
import { parseDiffFiles } from "../file-preview/file-format";
import type { Changes } from "./types";

/** Files start collapsed past this many, so a long list stays scannable. */
const OPEN_FILES = 8;

type ChangesViewProps = {
  changes: Changes;
};

/** Every changed file's diff, in Git's order, each collapsible. */
export function ChangesView({ changes }: ChangesViewProps) {
  const files = useMemo(() => parseDiffFiles(changes.diff), [changes.diff]);

  return (
    <div className="diff-view">
      {files.map((file, index) => (
        <DiffFile
          // Git lists files in the same order in the diff and the file list.
          key={changes.files[index]?.path ?? index}
          file={file}
          initiallyOpen={files.length <= OPEN_FILES}
          emptyNote={
            changes.files[index]?.binary
              ? "Binary file changed"
              : "No content changes"
          }
        />
      ))}
    </div>
  );
}

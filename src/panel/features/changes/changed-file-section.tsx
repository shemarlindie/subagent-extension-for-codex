import { useState } from "react";

import { Button } from "../../shared/components/button/button";
import { Icon } from "../../shared/components/icons/icons";
import { TooltipWrapper } from "../../shared/components/tooltip";
import { DiffFile } from "../file-preview/diff/diff-file";
import type { ChangedFileEntry } from "./changed-files";
import { FILE_ATTRIBUTE } from "./changes-reading";
import type { ChangedFile } from "./types";
import { ViewedToggle } from "./viewed-toggle";

type ChangedFileSectionProps = {
  entry: ChangedFileEntry;
  /** Opened or closed by the reader earlier, if they did. */
  remembered?: boolean;
  /** Whether the file opens when the reader hasn't chosen. */
  openByDefault: boolean;
  viewed: boolean;
  /** Marked viewed, then changed: it needs reading again. */
  changedSinceViewed: boolean;
  onOpenChange: (open: boolean) => void;
  /** Counts the reader's picks of this file in the file tree; each one opens it. */
  revealed?: number;
  onContentReady?: () => void;
  onViewedChange: (viewed: boolean) => void;
  onPreview: () => void;
};

/** Why a file's diff has no lines to show. */
function emptyDiffNote(file: ChangedFile, missing?: boolean) {
  if (file.incomplete) return "An edit to this file wasn't recorded.";

  return missing ? "Diff unavailable" : "No content changes";
}

/** The short tag keeps narrow file headers readable; the note explains it. */
const COMMAND_NOTE = "Changed by a command.";

/** One changed file in the Changes list: its diff, Preview and Viewed. */
export function ChangedFileSection({
  entry: { file, diff, missing },
  remembered,
  openByDefault,
  viewed,
  changedSinceViewed,
  onOpenChange,
  revealed,
  onContentReady,
  onViewedChange,
  onPreview,
}: ChangedFileSectionProps) {
  const [open, setOpen] = useState(
    () => remembered ?? (changedSinceViewed || (openByDefault && !viewed)),
  );

  // Marking the file viewed, here or in its preview, collapses it.
  const [wasViewed, setWasViewed] = useState(viewed);

  if (viewed !== wasViewed) {
    setWasViewed(viewed);
    setOpen(!viewed);
  }

  const [wasRevealed, setWasRevealed] = useState(revealed);

  // Picking another file passes undefined, which leaves this one as it is.
  if (revealed !== undefined && revealed !== wasRevealed) {
    setWasRevealed(revealed);
    setOpen(true);
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    onOpenChange(next);
  };

  return (
    <DiffFile
      // Names the file, so the tab can return to it.
      {...{ [FILE_ATTRIBUTE]: file.path }}
      data-viewed={String(viewed)}
      file={diff}
      initiallyOpen={open}
      open={open}
      onOpenChange={handleOpenChange}
      onContentReady={onContentReady}
      emptyNote={emptyDiffNote(file, missing)}
      {...(file.source === "command"
        ? { tag: "command", note: COMMAND_NOTE }
        : {})}
      actions={
        <>
          <TooltipWrapper label={`Preview ${file.path}`}>
            <Button
              variant="ghost"
              className="diff-preview"
              onClick={onPreview}
            >
              <Icon name="eye" size={14} />
            </Button>
          </TooltipWrapper>
          <ViewedToggle
            path={file.path}
            viewed={viewed}
            onChange={onViewedChange}
          />
        </>
      }
    />
  );
}

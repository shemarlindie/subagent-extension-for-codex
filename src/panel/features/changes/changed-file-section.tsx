import { useState } from "react";

import { imageMime } from "../../../shared/workspaces/changes";
import { Button } from "../../shared/components/button/button";
import { Icon } from "../../shared/components/icons/icons";
import { TooltipWrapper } from "../../shared/components/tooltip";
import { formatBytes } from "../../shared/utils/format";
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
  onViewedChange: (viewed: boolean) => void;
  onPreview: () => void;
};

/** A binary file has no lines to show; an image can still be previewed. */
function binaryNote(file: ChangedFile) {
  return file.size === undefined
    ? "Binary file changed"
    : `Binary file changed · ${formatBytes(file.size)}`;
}

const previewable = (file: ChangedFile) =>
  !file.binary || Boolean(imageMime(file.path));

/** One changed file in the Changes list: its diff, Preview and Viewed. */
export function ChangedFileSection({
  entry: { file, diff, missing },
  remembered,
  openByDefault,
  viewed,
  changedSinceViewed,
  onOpenChange,
  onViewedChange,
  onPreview,
}: ChangedFileSectionProps) {
  const [open, setOpen] = useState(
      () => remembered ?? (changedSinceViewed || (openByDefault && !viewed)),
    ),
    // Marking the file viewed, here or in its preview, collapses it.
    [wasViewed, setWasViewed] = useState(viewed);

  if (viewed !== wasViewed) {
    setWasViewed(viewed);
    setOpen(!viewed);
  }

  return (
    <DiffFile
      // Names the file, so the tab can return to it.
      {...{ [FILE_ATTRIBUTE]: file.path }}
      data-viewed={String(viewed)}
      file={diff}
      initiallyOpen={open}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange(next);
      }}
      emptyNote={
        file.binary
          ? binaryNote(file)
          : missing
            ? "Diff unavailable"
            : "No content changes"
      }
      actions={
        <>
          {previewable(file) && (
            <TooltipWrapper label={`Preview ${file.path}`}>
              <Button
                variant="ghost"
                className="diff-preview"
                onClick={onPreview}
              >
                <Icon name="eye" size={14} />
              </Button>
            </TooltipWrapper>
          )}
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

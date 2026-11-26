import { memo, useEffect, useLayoutEffect, useState } from "react";

import { Button } from "../../shared/components/button/button";
import { Icon } from "../../shared/components/icons/icons";
import { TooltipWrapper } from "../../shared/components/tooltip";
import { DiffFile } from "../file-preview/diff/diff-file";
import { Progress } from "../file-preview/progress";
import { standIn } from "./changed-files";
import { FILE_ATTRIBUTE } from "./changes-reading";
import { DiffReadError } from "./diff-read-error";
import type { FileDiff, ListedChange } from "./types";
import { ViewedToggle } from "./viewed-toggle";

type ChangedFileSectionProps = {
  file: ListedChange;
  /** The file's diff, once asked for. */
  diff?: FileDiff;
  /** Opened or closed by the reader earlier, if they did. */
  remembered?: boolean;
  /** Whether the file opens when the reader hasn't chosen. */
  openByDefault: boolean;
  viewed: boolean;
  /** Marked viewed, then changed: it needs reading again. */
  changedSinceViewed: boolean;
  onOpenChange: (path: string, open: boolean) => void;
  /** Counts the reader's picks of this file in the file tree; each one opens it. */
  revealed?: number;
  onContentReady?: () => void;
  onViewedChange: (file: ListedChange, viewed: boolean) => void;
  onPreview: (path: string) => void;
  /** Reads the file's diff, or reads it again after a failure. */
  onLoadDiff: (path: string) => void;
};

/** Why a file's diff has no lines to show. */
function emptyDiffNote(file: ListedChange, diff?: FileDiff) {
  if (file.incomplete) return "An edit to this file wasn't recorded.";

  return diff?.status === "ready" && !diff.diff
    ? "Diff unavailable"
    : "No content changes";
}

/** The short tag keeps narrow file headers readable; the note explains it. */
const COMMAND_NOTE = "Changed by a command.";

/**
 * One changed file in the Changes list: its diff, Preview and Viewed. Opening
 * it reads its diff. It renders only when its own props change, so its
 * callbacks take the file.
 */
export const ChangedFileSection = memo(function ChangedFileSection({
  file,
  diff,
  remembered,
  openByDefault,
  viewed,
  changedSinceViewed,
  onOpenChange,
  revealed,
  onContentReady,
  onViewedChange,
  onPreview,
  onLoadDiff,
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

  const needsDiff = open && !file.incomplete;
  const error = needsDiff && diff?.status === "error" ? diff.error : undefined;
  const failed = error !== undefined;

  useEffect(() => {
    if (needsDiff && !diff) onLoadDiff(file.path);
  }, [needsDiff, diff, file.path, onLoadDiff]);

  // A file picked in the tree is ready to scroll to once its read fails too,
  // which brings Retry into view.
  useLayoutEffect(() => {
    if (failed) onContentReady?.();
  }, [failed, onContentReady]);

  let placeholder;

  if (failed) {
    placeholder = (
      <DiffReadError error={error} onRetry={() => onLoadDiff(file.path)} />
    );
  } else if (needsDiff && diff?.status !== "ready") {
    placeholder = (
      <Progress label={`Loading ${file.path}`} className="diff-progress" />
    );
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    onOpenChange(file.path, next);
  };

  return (
    <DiffFile
      // Names the file, so the tab can return to it.
      {...{ [FILE_ATTRIBUTE]: file.path }}
      data-viewed={String(viewed)}
      file={(diff?.status === "ready" && diff.diff) || standIn(file)}
      initiallyOpen={open}
      open={open}
      onOpenChange={handleOpenChange}
      onContentReady={onContentReady}
      emptyNote={emptyDiffNote(file, diff)}
      placeholder={placeholder}
      {...(file.source === "command"
        ? { tag: "command", note: COMMAND_NOTE }
        : {})}
      actions={
        <>
          <TooltipWrapper label={`Preview ${file.path}`}>
            <Button
              variant="ghost"
              className="diff-preview"
              onClick={() => onPreview(file.path)}
            >
              <Icon name="eye" size={14} />
            </Button>
          </TooltipWrapper>
          <ViewedToggle
            path={file.path}
            viewed={viewed}
            onChange={(value) => onViewedChange(file, value)}
          />
        </>
      }
    />
  );
});

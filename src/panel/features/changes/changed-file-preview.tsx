import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useController, useSnapshot } from "../../app/state/controller-context";
import { LoadingSpinner } from "../../shared/components/loading-spinner/loading-spinner";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import { formatBytes } from "../../shared/utils/format";
import { scrollContainer } from "../../shared/utils/scroll-container";
import { DiffFile } from "../file-preview/diff/diff-file";
import { FileBadge } from "../file-preview/file-badge";
import {
  fileFormat,
  fileName,
  type FileView,
} from "../file-preview/file-format";
import { FilePreview } from "../file-preview/file-preview";
import { FilePreviewOptions } from "../file-preview/file-preview-options";
import { Progress } from "../file-preview/progress";
import type { Task } from "../tasks/types";
import { AskFileButton } from "./ask-file-button";
import { ChangedFileNav } from "./changed-file-nav";
import { changedFileDiff, changedFileEntries } from "./changed-files";
import { readChangedFile } from "./read-changes";
import type { ChangedFileContent } from "./types";
import { isViewed, nextUnviewed, useViewedFiles } from "./use-viewed-files";
import { ViewedToggle } from "./viewed-toggle";

type Settled =
  | { status: "ready"; file: ChangedFileContent }
  | { status: "error"; message: string };

/** The last file read, which stays until the next one is ready. */
type Read = Settled & { taskId: string; path: string };

/** Reads the file, every part, when the preview opens or moves to it. */
function useChangedFile(task: Task, path: string) {
  const controller = useController(),
    [read, setRead] = useState<Read>();

  useEffect(() => {
    let current = true;

    readChangedFile(task.id, path, (args) =>
      controller.tool<ChangedFileContent>("get_agent_changed_file", args),
    ).then(
      (file) =>
        current && setRead({ taskId: task.id, path, status: "ready", file }),
      (error: unknown) =>
        current &&
        setRead({
          taskId: task.id,
          path,
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
    );

    return () => {
      current = false;
    };
  }, [controller, task.id, path]);

  return read?.taskId === task.id ? read : undefined;
}

/** The task's changes, as the Changes tab last read them. */
function useChanges(task: Task) {
  const { changes } = useSnapshot();

  return changes?.task === task.id ? changes.data : undefined;
}

type ChangedFileViewedProps = {
  task: Task;
  path: string;
  /** Called once the file is marked viewed, to move on to the next unread one. */
  onViewed: (next?: string) => void;
};

/** The shown file's Viewed checkbox, when it is a changed file. */
function ChangedFileViewed({ task, path, onViewed }: ChangedFileViewedProps) {
  const data = useChanges(task),
    entries = data ? changedFileEntries(data) : [],
    [viewed, setViewed] = useViewedFiles(task.id),
    entry = entries.find((entry) => entry.file.path === path);

  if (!entry) return null;

  const handleChange = (value: boolean) => {
    setViewed(entry, value);
    if (value) onViewed(nextUnviewed(viewed, entries, entry)?.file.path);
  };

  return (
    <ViewedToggle
      path={path}
      viewed={isViewed(viewed, entry)}
      onChange={handleChange}
    />
  );
}

type ChangedFilePreviewProps = {
  task: Task;
  path: string;
};

/**
 * A changed file as it is now: a preview, or why there is none. Moving to
 * another file keeps this one showing until the next is read, so the layout
 * changes once rather than through a loading state.
 */
export function ChangedFilePreview({ task, path }: ChangedFilePreviewProps) {
  const controller = useController(),
    read = useChangedFile(task, path),
    // The file showing: the one asked for once read, until then the last one.
    shown = read?.path ?? path,
    loading = read?.path !== path,
    data = useChanges(task),
    diff = useMemo(() => data && changedFileDiff(data, shown), [data, shown]),
    file = read?.status === "ready" ? read.file : undefined,
    progress = loading && read ? <Progress label={`Loading ${path}`} /> : null,
    // Kept across files, so stepping through them stays in, say, Diff.
    [view, setView] = useState<FileView>(),
    [wrapLines, setWrapLines] = useState(false),
    [optionsTarget, setOptionsTarget] = useState<HTMLElement | null>(null),
    [viewSwitcherTarget, setViewSwitcherTarget] = useState<HTMLElement | null>(
      null,
    ),
    root = useRef<HTMLDivElement>(null),
    // Viewed was used to move on, so the next file's Viewed takes focus.
    refocusViewed = useRef(false),
    handleViewed = (next?: string) => {
      if (!next) return;
      refocusViewed.current = true;
      controller.showChangedFile(next);
    },
    viewedToggle = (
      <ChangedFileViewed task={task} path={shown} onViewed={handleViewed} />
    ),
    askButton = (
      <AskFileButton
        task={task}
        path={shown}
        disabled={loading}
        contextText={
          file?.content ??
          diff?.chunks
            .flatMap((chunk) => [
              chunk.content,
              ...chunk.changes.map((change) => change.content),
            ])
            .join("\n")
        }
      />
    );

  const firstRead = loading && !read;

  // Each file starts at its top.
  useLayoutEffect(() => {
    if (root.current) {
      scrollContainer(root.current).scrollTop = 0;
      // A preview portals its tabs only into its own dialog's title row.
      const dialog = root.current.closest(".dialog");

      setViewSwitcherTarget(
        dialog?.querySelector<HTMLElement>(
          "[data-file-preview-view-switcher]",
        ) ?? null,
      );

      setOptionsTarget(
        dialog?.querySelector<HTMLElement>("[data-file-preview-options]") ??
          null,
      );
    }

    // A file of another kind remounts the toolbar, which drops focus. Only
    // dropped focus moves, not focus the user took elsewhere meanwhile.
    if (refocusViewed.current) {
      const active = document.activeElement;

      refocusViewed.current = false;

      if (
        !active ||
        active === document.body ||
        active.getAttribute("role") === "dialog"
      ) {
        root.current?.querySelector<HTMLElement>(".viewed-toggle")?.focus();
      }
    }
  }, [shown]);

  return (
    <div
      className="changed-file-preview"
      ref={root}
      aria-busy={loading}
      data-stale={loading && Boolean(read)}
      data-initial-loading={firstRead || undefined}
    >
      {optionsTarget &&
        createPortal(
          <FilePreviewOptions
            wrapLines={wrapLines}
            onWrapLinesChange={setWrapLines}
          />,
          optionsTarget,
        )}
      <p className="help file-preview-note">File as it is now</p>
      {firstRead && (
        <div
          className="file-preview-loading"
          role="status"
          aria-label="Loading file preview"
        >
          <LoadingSpinner />
        </div>
      )}
      {!firstRead && file?.state === "present" && (
        <FilePreview
          file={{
            path: shown,
            content: file.content ?? "",
            mime_type: file.mime_type,
          }}
          viewSwitcherTarget={viewSwitcherTarget}
          beforeActions={askButton}
          actions={viewedToggle}
          diff={diff}
          view={view}
          onViewChange={setView}
          progress={progress}
          alwaysShowViews
          wrapLines={wrapLines}
        />
      )}
      {!firstRead && file?.state !== "present" && (
        <div className="file-preview" data-wrap-lines={wrapLines}>
          <div className="file-preview-toolbar">
            {/* A loaded file's shape, so the toolbar holds its height. */}
            <FileBadge
              path={shown}
              format={fileFormat({
                path: shown,
                content: "",
                mime_type: file?.mime_type,
              })}
            />
            <span className="file-meta">
              <span className="file-name">{fileName(shown)}</span>
            </span>
            <span className="toolbar-actions">
              {askButton}
              {viewedToggle}
            </span>
            {progress}
          </div>
          <div className="file-preview-body">
            {read.status === "error" && (
              <p className="form-error" role="alert">
                {read.message}
              </p>
            )}
            {file?.state === "unavailable" && (
              <p className="help">
                The workspace was removed, so this file is unavailable.
              </p>
            )}
            {file?.state === "deleted" && (
              <>
                <p className="help file-preview-note">Deleted</p>
                {/* What it held, so reviewing every file misses nothing. */}
                {diff && (
                  <div className="diff-view">
                    <DiffFile file={diff} initiallyOpen />
                  </div>
                )}
              </>
            )}
            {file?.state === "binary" && (
              <p className="help">
                Binary file changed · {formatBytes(file.size)}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const changedFileDialog = defineDialog<"file">({
  title: ({ path }) => path,
  render: ({ task, path }) => <ChangedFilePreview task={task} path={path} />,
  // Keep navigation mounted across files.
  headingActions: ({ task, path }) => (
    <div className="changed-file-heading-actions">
      <span
        className="changed-file-view-switcher-target"
        data-file-preview-view-switcher
      />
      <ChangedFileNav task={task} path={path} />
      <span className="changed-file-options-target" data-file-preview-options />
    </div>
  ),
});

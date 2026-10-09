import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useController, useSnapshot } from "../../app/state/controller-context";
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
import { Progress } from "../file-preview/progress";
import type { Task } from "../tasks/types";
import { ChangedFileNav } from "./changed-file-nav";
import { changedFileDiff } from "./changed-files";
import { readChangedFile } from "./read-changes";
import { ShareFileButton } from "./share-file-button";
import type { ChangedFileContent } from "./types";

type Settled =
  | { status: "ready"; file: ChangedFileContent }
  | { status: "error"; message: string };

/** The last file read, which stays until the next one is ready. */
type Read = Settled & { path: string };

/** Reads the file, every part, when the preview opens or moves to it. */
function useChangedFile(task: Task, path: string) {
  const controller = useController(),
    [read, setRead] = useState<Read>();

  useEffect(() => {
    let current = true;

    readChangedFile(task.id, path, (args) =>
      controller.tool<ChangedFileContent>("get_user_agent_changed_file", args),
    ).then(
      (file) => current && setRead({ path, status: "ready", file }),
      (error: unknown) =>
        current &&
        setRead({
          path,
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
    );

    return () => {
      current = false;
    };
  }, [controller, task.id, path]);

  return read;
}

/** The file's part of the task's changes, as the Changes tab last read them. */
function useChangedFileDiff(task: Task, path: string) {
  const { changes } = useSnapshot(),
    data = changes?.task === task.id ? changes.data : undefined;

  return useMemo(() => data && changedFileDiff(data, path), [data, path]);
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
  const read = useChangedFile(task, path),
    // The file showing: the one asked for once read, until then the last one.
    shown = read?.path ?? path,
    loading = read?.path !== path,
    diff = useChangedFileDiff(task, shown),
    file = read?.status === "ready" ? read.file : undefined,
    progress = loading && <Progress label={`Loading ${path}`} />,
    // Kept across files, so stepping through them stays in, say, Diff.
    [view, setView] = useState<FileView>(),
    root = useRef<HTMLDivElement>(null);

  // Each file starts at its top.
  useLayoutEffect(() => {
    if (root.current) scrollContainer(root.current).scrollTop = 0;
  }, [shown]);

  return (
    <div
      className="changed-file-preview"
      ref={root}
      aria-busy={loading}
      data-stale={loading && Boolean(read)}
    >
      {/* Outside the file's states, so its controls stay put and keep focus. */}
      <ChangedFileNav task={task} path={path} />
      {file?.state === "present" ? (
        <FilePreview
          file={{
            path: shown,
            content: file.content ?? "",
            mime_type: file.mime_type,
          }}
          actions={<ShareFileButton path={shown} />}
          diff={diff}
          view={view}
          onViewChange={setView}
          progress={progress}
          alwaysShowViews
        />
      ) : (
        <div className="file-preview">
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
            {/* Holds the switcher's place, which a file with no views lacks. */}
            <span className="view-switch view-switch-placeholder" aria-hidden>
              <span className="view-option">Source</span>
            </span>
            <span className="toolbar-actions">
              <ShareFileButton path={shown} />
            </span>
            {progress}
          </div>
          <div className="file-preview-body">
            {read?.status === "error" ? (
              <p className="form-error" role="alert">
                {read.message}
              </p>
            ) : file?.state === "deleted" ? (
              <>
                <p className="help file-preview-note">Deleted</p>
                {/* What it held, so reviewing every file misses nothing. */}
                {diff && (
                  <div className="diff-view">
                    <DiffFile file={diff} initiallyOpen />
                  </div>
                )}
              </>
            ) : file?.state === "binary" ? (
              <p className="help">
                Binary file changed · {formatBytes(file.size)}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export const changedFileDialog = defineDialog<"file">({
  title: ({ path }) => path,
  render: ({ task, path }) => <ChangedFilePreview task={task} path={path} />,
});

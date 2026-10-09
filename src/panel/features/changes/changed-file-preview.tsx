import { useEffect, useState } from "react";

import { useController } from "../../app/state/controller-context";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import { formatBytes } from "../../shared/utils/format";
import { fileName } from "../file-preview/file-format";
import { FilePreview } from "../file-preview/file-preview";
import { Progress } from "../file-preview/progress";
import type { Task } from "../tasks/types";
import { readChangedFile } from "./read-changes";
import { ShareFileButton } from "./share-file-button";
import type { ChangedFileContent } from "./types";

type Loaded =
  | { status: "loading" }
  | { status: "ready"; file: ChangedFileContent }
  | { status: "error"; message: string };

/** Reads the file, every part, when the preview opens. */
function useChangedFile(task: Task, path: string) {
  const controller = useController(),
    [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

  useEffect(() => {
    let current = true;

    readChangedFile(task.id, path, (args) =>
      controller.tool<ChangedFileContent>("get_user_agent_changed_file", args),
    ).then(
      (file) => current && setLoaded({ status: "ready", file }),
      (error: unknown) =>
        current &&
        setLoaded({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
    );

    return () => {
      current = false;
    };
  }, [controller, task.id, path]);

  return loaded;
}

type ChangedFilePreviewProps = {
  task: Task;
  path: string;
};

/** A changed file as it is now: a preview, or why there is none. */
export function ChangedFilePreview({ task, path }: ChangedFilePreviewProps) {
  const loaded = useChangedFile(task, path),
    file = loaded.status === "ready" ? loaded.file : undefined;

  if (file?.state === "present")
    return (
      <FilePreview
        file={{ path, content: file.content ?? "", mime_type: file.mime_type }}
        actions={<ShareFileButton path={path} />}
      />
    );

  return (
    <div className="file-preview">
      <div className="file-preview-toolbar">
        <span className="file-meta">
          <span className="file-name">{fileName(path)}</span>
        </span>
        <span className="toolbar-actions">
          <ShareFileButton path={path} />
        </span>
        {loaded.status === "loading" && <Progress label={`Loading ${path}`} />}
      </div>
      <div className="file-preview-body">
        {loaded.status === "error" ? (
          <p className="form-error" role="alert">
            {loaded.message}
          </p>
        ) : file?.state === "deleted" ? (
          <p className="help">Deleted</p>
        ) : file?.state === "binary" ? (
          <p className="help">Binary file changed · {formatBytes(file.size)}</p>
        ) : null}
      </div>
    </div>
  );
}

export const changedFileDialog = defineDialog<"file">({
  title: ({ path }) => path,
  render: ({ task, path }) => <ChangedFilePreview task={task} path={path} />,
});

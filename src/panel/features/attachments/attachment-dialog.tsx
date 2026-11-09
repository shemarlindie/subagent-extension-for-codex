import { useEffect, useState } from "react";

import type {
  AttachmentPage,
  RequestAttachment,
} from "../../../shared/attachments/model.js";
import { useController } from "../../app/state/controller-context";
import { Icon } from "../../shared/components/icons/icons";
import { LoadingSpinner } from "../../shared/components/loading-spinner/loading-spinner";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import { FilePreview } from "../file-preview/file-preview";
import type { Task } from "../tasks/types";
import {
  attachmentFile,
  attachmentIcon,
  attachmentOrigin,
} from "./attachment-display";
import { readAttachment } from "./read-attachment";

type Read =
  | { status: "ready"; page: AttachmentPage }
  | { status: "error"; message: string };

/** Reads the whole attachment once the dialog opens. */
function useAttachment(task: Task, position: number) {
  const controller = useController(),
    [read, setRead] = useState<Read>();

  useEffect(() => {
    let current = true;

    readAttachment(task.id, position, (args) =>
      controller.tool<AttachmentPage>("app_get_attachment", args),
    ).then(
      (page) => current && setRead({ status: "ready", page }),
      (error: unknown) =>
        current &&
        setRead({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
    );

    return () => {
      current = false;
    };
  }, [controller, task.id, position]);

  return read;
}

type AttachmentHeaderProps = { attachment: RequestAttachment };

function AttachmentHeader({ attachment }: AttachmentHeaderProps) {
  return (
    <div className="attachment-header">
      <Icon name={attachmentIcon(attachment)} size={13} />
      <div>
        <p className="attachment-summary">{attachment.summary}</p>
        <p className="attachment-origin">{attachmentOrigin(attachment)}</p>
      </div>
    </div>
  );
}

type AttachmentPreviewProps = {
  task: Task;
  attachment: RequestAttachment;
};

/** An attachment's summary and origin, then its content in a file viewer. */
function AttachmentPreview({ task, attachment }: AttachmentPreviewProps) {
  const read = useAttachment(task, attachment.position),
    page = read?.status === "ready" ? read.page : undefined;

  return (
    <div className="attachment-preview" aria-busy={!read}>
      <AttachmentHeader attachment={attachment} />
      {!read && (
        <div
          className="file-preview-loading"
          role="status"
          aria-label="Loading attachment"
        >
          <LoadingSpinner />
        </div>
      )}
      {read?.status === "error" && (
        <p className="form-error" role="alert">
          {read.message}
        </p>
      )}
      {page?.state === "unavailable" && (
        <p className="help">
          This attachment's file is unavailable. It was removed from the
          extension's data folder or changed there.
        </p>
      )}
      {page?.state === "present" && (
        <FilePreview
          file={attachmentFile(page.attachment, page.content ?? "")}
        />
      )}
    </div>
  );
}

export const attachmentDialog = defineDialog<"attachment">({
  title: ({ attachment }) => attachment.title,
  render: ({ task, attachment }) => (
    <AttachmentPreview task={task} attachment={attachment} />
  ),
});

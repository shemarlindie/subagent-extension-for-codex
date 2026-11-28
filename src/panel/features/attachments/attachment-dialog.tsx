import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  isBinaryFormat,
  type AttachmentPage,
  type MessageAttachment,
} from "../../../core/shared/attachments/model.js";
import { useController, useSnapshot } from "../../app/state/controller-context";
import { Icon } from "../../shared/components/icons/icons";
import { LoadingSpinner } from "../../shared/components/loading-spinner/loading-spinner";
import { StepNav } from "../../shared/components/step-nav/step-nav";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import { fileFormat } from "../file-preview/file-format";
import { FilePreview } from "../file-preview/file-preview";
import { FilePreviewOptions } from "../file-preview/file-preview-options";
import { FileToolbar } from "../file-preview/file-toolbar";
import { usePreviewHeading } from "../file-preview/use-preview-heading";
import type { Task } from "../tasks/types";
import {
  attachmentFile,
  attachmentIcon,
  attachmentOrigin,
  displayTitle,
} from "./attachment-display";
import { readAttachment } from "./read-attachment";

type Read = { position: number } & (
  | { status: "ready"; page: AttachmentPage }
  | { status: "error"; message: string }
);

/**
 * Reads the whole attachment at `position` in message `messageId`. Returns
 * nothing until that read settles, so a step never shows the previous
 * attachment's content.
 */
function useAttachment(task: Task, messageId: string, position: number) {
  const controller = useController();
  const [read, setRead] = useState<Read>();

  useEffect(() => {
    // Closing the dialog or stepping away stops reading further pages.
    const reading = new AbortController();
    const { signal } = reading;

    readAttachment(
      task.id,
      { message_id: messageId, position },
      (args) => controller.tool<AttachmentPage>("app_get_attachment", args),
      signal,
    ).then(
      (page) => !signal.aborted && setRead({ position, status: "ready", page }),
      (error: unknown) =>
        !signal.aborted &&
        setRead({
          position,
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }),
    );

    return () => reading.abort();
  }, [controller, task.id, messageId, position]);

  return read?.position === position ? read : undefined;
}

type AttachmentProps = { attachment: MessageAttachment };

/**
 * The parent agent's summary and where the file came from. An upload's summary
 * only repeats its name, so uploads show just the file row, as in the composer.
 */
function AttachmentHeader({ attachment }: AttachmentProps) {
  if (attachment.source === "upload") return null;

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

/**
 * The file row from the attachment's record, for states without content. A
 * text attachment's size is its character count until its content is read.
 */
function AttachmentToolbar({ attachment }: AttachmentProps) {
  const file = attachmentFile(attachment, "");

  return (
    <FileToolbar
      path={file.path}
      format={fileFormat(file)}
      bytes={
        isBinaryFormat(attachment.format)
          ? (attachment.bytes ?? 0)
          : attachment.chars
      }
    />
  );
}

/** A document has no viewer, so the dialog shows only its file row and summary. */
function DocumentAttachment({ attachment }: AttachmentProps) {
  return (
    <div className="attachment-preview">
      <AttachmentToolbar attachment={attachment} />
      <AttachmentHeader attachment={attachment} />
      <p className="help">
        The panel can't preview this file type. The worker opens it with its own
        tools.
      </p>
    </div>
  );
}

type AttachmentPreviewProps = {
  task: Task;
  attachment: MessageAttachment;
};

/** The attachment's file row and summary, then its content in a file viewer. */
function AttachmentPreview({ task, attachment }: AttachmentPreviewProps) {
  const read = useAttachment(task, attachment.message_id, attachment.position);
  const page = read?.status === "ready" ? read.page : undefined;
  const controller = useController();

  const wrapLines = useSnapshot(
    (state) => state.panelSettings.attachment_wrap_lines,
  );

  const root = useRef<HTMLDivElement>(null);
  const optionsTarget = usePreviewHeading(root);

  return (
    <div className="attachment-preview" ref={root} aria-busy={!read}>
      {/* Shown in every state, so the heading's controls never shift. */}
      {attachment.format !== "image" &&
        optionsTarget &&
        createPortal(
          <FilePreviewOptions
            wrapLines={wrapLines}
            onWrapLinesChange={(value) =>
              void controller.panelSettings.set("attachment_wrap_lines", value)
            }
          />,
          optionsTarget,
        )}
      {page?.state === "present" ? (
        <FilePreview
          file={attachmentFile(page.attachment, page.content ?? "")}
          wrapLines={wrapLines}
          before={<AttachmentHeader attachment={attachment} />}
        />
      ) : (
        <>
          <AttachmentToolbar attachment={attachment} />
          <AttachmentHeader attachment={attachment} />
        </>
      )}
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
    </div>
  );
}

type AttachmentNavProps = {
  attachment: MessageAttachment;
  attachments: MessageAttachment[];
};

/** Steps through the message's attachments in the order its chips show. */
function AttachmentNav({ attachment, attachments }: AttachmentNavProps) {
  const controller = useController();

  const showAt = (index: number) => {
    const next = attachments[index];
    if (next) controller.showAttachment(next);
  };

  return (
    <StepNav
      label="Attachments"
      noun="attachment"
      index={attachments.findIndex((a) => a.position === attachment.position)}
      count={attachments.length}
      onStep={showAt}
    />
  );
}

export const attachmentDialog = defineDialog<"attachment">({
  title: ({ attachment }) => displayTitle(attachment),
  render: ({ task, attachment }) =>
    attachment.format === "document" ? (
      <DocumentAttachment attachment={attachment} />
    ) : (
      <AttachmentPreview task={task} attachment={attachment} />
    ),
  headingActions: ({ attachment, attachments }) => (
    <div className="file-preview-heading-actions">
      {/* A lone attachment has nowhere to step to. */}
      {attachments.length > 1 && (
        <AttachmentNav attachment={attachment} attachments={attachments} />
      )}
      <span className="file-preview-options-target" data-file-preview-options />
    </div>
  ),
});

export const draftAttachmentDialog = defineDialog<"draft-attachment">({
  title: ({ file }) => file.path,
  render: ({ file }) => <FilePreview file={file} />,
});

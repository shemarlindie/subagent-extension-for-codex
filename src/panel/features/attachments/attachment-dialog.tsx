import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type {
  AttachmentPage,
  RequestAttachment,
} from "../../../shared/attachments/model.js";
import { useController } from "../../app/state/controller-context";
import { Icon } from "../../shared/components/icons/icons";
import { LoadingSpinner } from "../../shared/components/loading-spinner/loading-spinner";
import { StepNav } from "../../shared/components/step-nav/step-nav";
import { defineDialog } from "../../shared/dialogs/dialog-definition";
import { FilePreview } from "../file-preview/file-preview";
import { FilePreviewOptions } from "../file-preview/file-preview-options";
import type { Task } from "../tasks/types";
import {
  attachmentFile,
  attachmentIcon,
  attachmentOrigin,
} from "./attachment-display";
import { readAttachment } from "./read-attachment";

type Read = { position: number } & (
  | { status: "ready"; page: AttachmentPage }
  | { status: "error"; message: string }
);

/**
 * Reads the whole attachment at `position`. Stepping to another keeps the last
 * read showing until the next one arrives, so no spinner flashes between them.
 */
function useAttachment(task: Task, position: number) {
  const controller = useController(),
    [read, setRead] = useState<Read>();

  useEffect(() => {
    let current = true;

    readAttachment(task.id, position, (args) =>
      controller.tool<AttachmentPage>("app_get_attachment", args),
    ).then(
      (page) => current && setRead({ position, status: "ready", page }),
      (error: unknown) =>
        current &&
        setRead({
          position,
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
    page = read?.status === "ready" ? read.page : undefined,
    // The previous attachment, still showing while this one is read.
    stale = read !== undefined && read.position !== attachment.position,
    [wrapLines, setWrapLines] = useState(false),
    [optionsTarget, setOptionsTarget] = useState<HTMLElement | null>(null),
    root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const dialog = root.current?.closest<HTMLElement>(".dialog"),
      heading = dialog?.querySelector<HTMLElement>(".dialog-heading");

    // The options sit in the dialog's heading, where Changes previews keep them.
    setOptionsTarget(
      dialog?.querySelector<HTMLElement>("[data-file-preview-options]") ?? null,
    );

    if (!dialog || !heading || typeof ResizeObserver === "undefined") return;

    // A wrapped heading is taller, so the pinned file toolbar moves down with it.
    const observer = new ResizeObserver(() =>
      dialog.style.setProperty(
        "--attachment-heading-height",
        `${heading.offsetHeight}px`,
      ),
    );

    observer.observe(heading);

    return () => {
      observer.disconnect();
      dialog.style.removeProperty("--attachment-heading-height");
    };
  }, []);

  return (
    <div
      className="attachment-preview"
      ref={root}
      aria-busy={!read || stale}
      data-stale={stale || undefined}
    >
      {/* Shown in every state, so the heading's controls never shift. */}
      {optionsTarget &&
        createPortal(
          <FilePreviewOptions
            wrapLines={wrapLines}
            onWrapLinesChange={setWrapLines}
          />,
          optionsTarget,
        )}
      <AttachmentHeader attachment={page?.attachment ?? attachment} />
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
          wrapLines={wrapLines}
        />
      )}
    </div>
  );
}

type AttachmentNavProps = {
  attachment: RequestAttachment;
  attachments: RequestAttachment[];
};

/** Steps through the message's attachments in the order its chips show. */
function AttachmentNav({ attachment, attachments }: AttachmentNavProps) {
  const controller = useController();

  return (
    <StepNav
      label="Attachments"
      noun="attachment"
      index={attachments.findIndex((a) => a.position === attachment.position)}
      count={attachments.length}
      onStep={(step) => controller.showAttachment(attachments[step]!)}
    />
  );
}

export const attachmentDialog = defineDialog<"attachment">({
  title: ({ attachment }) => attachment.title,
  render: ({ task, attachment }) => (
    <AttachmentPreview task={task} attachment={attachment} />
  ),
  headingActions: ({ attachment, attachments }) => (
    <div className="attachment-heading-actions">
      {/* A lone attachment has nowhere to step to. */}
      {attachments.length > 1 && (
        <AttachmentNav attachment={attachment} attachments={attachments} />
      )}
      <span className="attachment-options-target" data-file-preview-options />
    </div>
  ),
});

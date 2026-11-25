import { useRef, useState } from "react";

import { Icon } from "../../shared/components/icons/icons";
import { LoadingSpinner } from "../../shared/components/loading-spinner/loading-spinner";
import { TooltipWrapper } from "../../shared/components/tooltip";
import { formatBytes } from "../../shared/utils/format";
import { AttachmentChipTitle, titleTruncated } from "./attachment-chip";
import { draftPreviewable, type DraftFile } from "./draft-file";

type DraftFileChipContentProps = {
  file: DraftFile;
  /** The measured copy draws an empty thumbnail. */
  copy?: boolean;
};

/** The thumbnail or icon, name and size, shared by the chip and its copy. */
export function DraftFileChipContent({
  file,
  copy,
}: DraftFileChipContentProps) {
  const { thumbnail } = file;
  let lead;

  if (!file.upload) {
    lead = <LoadingSpinner />;
  } else if (thumbnail) {
    lead = copy ? null : <img src={thumbnail} alt="" />;
  } else {
    lead = <Icon name="file-text" size={11} />;
  }

  return (
    <>
      <span
        className="draft-file-lead"
        data-image={Boolean(thumbnail) || undefined}
      >
        {lead}
      </span>
      <AttachmentChipTitle title={file.name} />
      <span className="attachment-chip-size">{formatBytes(file.size)}</span>
    </>
  );
}

type DraftFileChipProps = {
  file: DraftFile;
  disabled: boolean;
  /** Selecting the chip previews its file, unless it's a document. */
  previewable: boolean;
  /** A narrow row truncates the first chip to this width. */
  maxWidth?: number;
  onOpen: () => void;
  onRemove: () => void;
};

/** A draft attachment. Hovering an image shows it larger. */
export function DraftFileChip({
  file,
  disabled,
  previewable,
  maxWidth,
  onOpen,
  onRemove,
}: DraftFileChipProps) {
  const chip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const { thumbnail } = file;
  const label = `${file.name}, ${formatBytes(file.size)}`;
  const opens = previewable && draftPreviewable(file);

  const handleOpenChange = (next: boolean) => {
    if (next) setTruncated(titleTruncated(chip.current));
    setOpen(next);
  };

  return (
    <span
      ref={chip}
      className="attachment-chip draft-file-chip"
      style={maxWidth === undefined ? undefined : { maxWidth }}
    >
      <TooltipWrapper
        label={label}
        content={
          thumbnail ? (
            <img className="draft-file-preview" src={thumbnail} alt="" />
          ) : undefined
        }
        triggerLabel={opens ? `Preview ${file.name}` : label}
        open={open && (truncated || Boolean(thumbnail))}
        onOpenChange={handleOpenChange}
      >
        {opens ? (
          <button
            type="button"
            className="draft-file-open"
            disabled={disabled || !file.upload}
            onClick={onOpen}
          >
            <DraftFileChipContent file={file} />
          </button>
        ) : (
          <span className="draft-file-open">
            <DraftFileChipContent file={file} />
          </span>
        )}
      </TooltipWrapper>
      <button
        type="button"
        className="draft-file-remove"
        aria-label={`Remove ${file.name}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <Icon name="close" size={7} />
      </button>
    </span>
  );
}

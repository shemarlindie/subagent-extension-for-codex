import { useRef, useState } from "react";

import { OCTET_STREAM } from "../../../shared/attachments/file-type";
import { useSnapshot } from "../../app/state/controller-context";
import { Icon } from "../../shared/components/icons/icons";
import { LoadingSpinner } from "../../shared/components/loading-spinner/loading-spinner";
import { TooltipWrapper } from "../../shared/components/tooltip";
import { formatBytes } from "../../shared/utils/format";
import { useSingleFlight } from "../../shared/utils/use-single-flight";
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
    // An image only lacks a thumbnail when the browser can't decode it.
    const generic =
      file.mime === OCTET_STREAM || file.mime?.startsWith("image/");

    lead = <Icon name={generic ? "file" : "file-text"} size={11} />;
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
  /** Whether the panel's preview can open, for hosts that don't open files. */
  previewable: boolean;
  /** A narrow row truncates the first chip to this width. */
  maxWidth?: number;
  onOpen: () => Promise<void>;
  onRemove: () => void;
};

/**
 * A draft attachment. Selecting it opens the file in the host's viewer, or
 * else previews a text file or image in the panel. Hovering an image shows it
 * larger.
 */
export function DraftFileChip({
  file,
  disabled,
  previewable,
  maxWidth,
  onOpen,
  onRemove,
}: DraftFileChipProps) {
  const hostOpens = useSnapshot((state) => state.host.canOpenFiles);
  const chip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [opening, run] = useSingleFlight();
  const { thumbnail } = file;
  const label = `${file.name}, ${formatBytes(file.size)}`;
  const opens = hostOpens || (previewable && draftPreviewable(file));

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
        triggerLabel={
          opens ? `${hostOpens ? "Open" : "Preview"} ${file.name}` : label
        }
        open={open && (truncated || Boolean(thumbnail))}
        onOpenChange={handleOpenChange}
      >
        {opens ? (
          <button
            type="button"
            className="draft-file-open"
            disabled={disabled || !file.upload}
            aria-busy={opening || undefined}
            onClick={() => run(onOpen)}
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

import { Button } from "../../shared/components/button/button";
import { Presence } from "../../shared/components/motion/presence";
import { AttachmentRow } from "./attachment-row";
import { DraftFileChip, DraftFileChipContent } from "./draft-file-chip";
import type { DraftFiles } from "./use-draft-files";

type DraftAttachmentsProps = {
  attachments: DraftFiles;
  disabled: boolean;
  /** False inside a dialog, which can't open the preview over itself. */
  previewable?: boolean;
};

/** A composer's draft files above its message box, and why any were refused. */
export function DraftAttachments({
  attachments: { files, errors, open, remove, dismissErrors },
  disabled,
  previewable = true,
}: DraftAttachmentsProps) {
  return (
    <Presence show={files.length > 0 || Boolean(errors?.length)}>
      <div className="draft-attachments">
        {files.length > 0 && (
          <AttachmentRow
            items={files}
            keyOf={(file) => file.id}
            layoutKey={files.map((file) => (file.upload ? 1 : 0)).join("")}
            chip={(file, maxWidth) => (
              <DraftFileChip
                file={file}
                disabled={disabled}
                previewable={previewable}
                maxWidth={maxWidth}
                onOpen={() => open(file)}
                onRemove={() => remove(file.id)}
              />
            )}
            copy={(file) => (
              <span className="attachment-chip draft-file-chip">
                <span className="draft-file-open">
                  <DraftFileChipContent file={file} copy />
                </span>
                <span className="draft-file-remove" />
              </span>
            )}
          />
        )}
        <Presence show={Boolean(errors?.length)}>
          <div role="alert" className="form-error draft-file-errors">
            <span>{errors?.join(" ")}</span>
            <Button variant="text" onClick={dismissErrors}>
              Dismiss
            </Button>
          </div>
        </Presence>
      </div>
    </Presence>
  );
}

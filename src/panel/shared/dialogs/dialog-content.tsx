import { memo } from "react";

import type { DialogState } from "../../app/state/types";
import { dialogDefinition } from "./dialog-registry";

type DialogContentProps = { dialog: DialogState };

/**
 * A dialog's form, which renders only when its dialog changes. The host also
 * renders for its busy and error state and while closing, which the form reads
 * itself or doesn't show.
 */
export const DialogContent = memo(function DialogContent({
  dialog,
}: DialogContentProps) {
  return dialogDefinition(dialog).render(dialog);
});

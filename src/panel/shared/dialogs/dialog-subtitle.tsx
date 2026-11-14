import { Dialog } from "@base-ui/react/dialog";

import { useSnapshot } from "../../app/state/controller-context";
import type { DialogState } from "../../app/state/types";
import { dialogDefinition } from "./dialog-registry";

type DialogSubtitleProps = { dialog: DialogState };

/** The definition's subtitle, which Base UI links as the dialog's description. */
export function DialogSubtitle({ dialog }: DialogSubtitleProps) {
  const subtitle = useSnapshot((state) =>
    dialogDefinition(dialog).subtitle?.(dialog, state),
  );

  return subtitle ? (
    <Dialog.Description className="help dialog-subtitle">
      {subtitle}
    </Dialog.Description>
  ) : null;
}

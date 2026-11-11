import { Toast } from "@base-ui/react/toast";

import { useSnapshot } from "./state/controller-context";
import { UndoNotification } from "./undo-notification";

/** How long an undo notice stays, unless hovered or focused. */
const UNDO_TIMEOUT_MS = 6000;

/**
 * Reports the last change the user made or undid, with Undo or Redo, or warns
 * that a step failed.
 */
export function UndoToast() {
  const notice = useSnapshot((state) => state.undoNotice);

  return notice ? (
    <Toast.Provider timeout={UNDO_TIMEOUT_MS} limit={1}>
      <UndoNotification notice={notice} timeout={UNDO_TIMEOUT_MS} />
    </Toast.Provider>
  ) : null;
}

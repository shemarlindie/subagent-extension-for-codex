import { Toast } from "@base-ui/react/toast";
import { useEffect } from "react";

import { buttonClass } from "../shared/components/button/button";
import { Icon } from "../shared/components/icons/icons";
import { useController, useSnapshot } from "./state/controller-context";
import type { UndoNotice } from "./state/undo-history";

/** A failure explains why nothing changed, so it stays longer. */
const FAILURE_TIMEOUT_MS = 10_000;

type UndoNotificationProps = {
  notice: UndoNotice;
  /** How long a notice that isn't a failure stays. */
  timeout: number;
};

/** The undo toast for one notice, updated in place as notices change. */
export function UndoNotification({ notice, timeout }: UndoNotificationProps) {
  const controller = useController(),
    busy = useSnapshot().busy,
    { add, toasts } = Toast.useToastManager();

  useEffect(() => {
    // One toast updates in place, keeping focus on its controls.
    add({
      id: "undo",
      title: notice.text,
      timeout: notice.failed ? FAILURE_TIMEOUT_MS : timeout,
      // Failures interrupt the screen reader, since the step didn't happen.
      priority: notice.failed ? "high" : "low",
      onClose: () => controller.undo.dismiss(notice.id),
    });
  }, [add, controller, notice, timeout]);

  const step = () =>
    controller.run(() =>
      notice.offer === "redo"
        ? controller.undo.redo(notice.steps)
        : controller.undo.undo(notice.steps),
    );

  return (
    <Toast.Viewport className="toast-viewport">
      {toasts.map((toast) => (
        <Toast.Root
          key={toast.id}
          toast={toast}
          className="toast-card undo-toast"
          data-failed={notice.failed || undefined}
          swipeDirection={[]}
        >
          <div className="undo-copy">
            <Toast.Title className="undo-text" title={notice.text} />
            {notice.items && (
              <Toast.Description render={<ul />} className="undo-items">
                {notice.items.map((item, index) => (
                  <li key={index} title={item}>
                    <span className="undo-item-text">{item}</span>
                  </li>
                ))}
                {notice.rest && (
                  <li className="undo-rest">
                    <span className="undo-item-text">{notice.rest}</span>
                  </li>
                )}
              </Toast.Description>
            )}
          </div>
          {notice.offer && (
            <Toast.Action
              data-action={notice.offer}
              disabled={busy}
              onClick={step}
            >
              {notice.offer === "redo" ? "Redo" : "Undo"}
            </Toast.Action>
          )}
          <Toast.Close
            aria-label="Dismiss"
            className={buttonClass("ghost", {
              className: "toolbar-icon-button undo-close",
            })}
          >
            <Icon name="close" size={10} />
          </Toast.Close>
        </Toast.Root>
      ))}
    </Toast.Viewport>
  );
}

import { Dialog } from "@base-ui/react/dialog";
import { useRef } from "react";

import { dialogDefinition } from "../forms/dialog-registry";
import { buttonClass } from "./button";
import { useController, useSnapshot } from "./controller-context";
import { useAnimatedHeight } from "./motion";

export function DialogHost({ suspended = false }: { suspended?: boolean }) {
  const controller = useController(),
    state = useSnapshot(),
    // The closing animation keeps showing the last dialog rather than an empty box.
    lastDialog = useRef(state.dialog);

  if (state.dialog) lastDialog.current = state.dialog;
  const dialog = state.dialog ?? lastDialog.current;
  const definition = dialog && dialogDefinition(dialog);

  const trigger = useRef<HTMLElement | null>(null),
    openedScope = useRef(0),
    popup = useRef<HTMLDivElement>(null);

  // Switching forms or showing an error eases the height instead of snapping it.
  useAnimatedHeight(popup, `${dialog?.kind}:${state.formError ?? ""}`);

  return (
    // Host collapse hides the modal; keeping its contents mounted retains drafts.
    <Dialog.Root
      open={Boolean(state.dialog) && !suspended}
      disablePointerDismissal
      onOpenChange={(open, details) => {
        if (state.busy) details.cancel();
        else if (!open) controller.dismiss();
      }}
    >
      <Dialog.Portal keepMounted={Boolean(state.dialog)}>
        <Dialog.Backdrop className="dialog-overlay" />
        <Dialog.Popup
          ref={popup}
          id="dialog"
          className="dialog"
          data-kind={dialog?.kind}
          aria-describedby={undefined}
          initialFocus={() => {
            trigger.current = document.activeElement as HTMLElement | null;
            openedScope.current = dialog?.scope ?? 0;

            return (
              (dialog && definition?.initialFocus?.(popup.current, dialog)) ||
              true
            );
          }}
          finalFocus={() =>
            suspended
              ? document.getElementById("open-panel")
              : openedScope.current === controller.getSnapshot().scopeVersion &&
                  trigger.current?.isConnected
                ? trigger.current
                : document.getElementById("delegate")
          }
        >
          <div className="dialog-heading">
            <Dialog.Title id="dialog-title">
              {dialog && definition?.title(dialog)}
            </Dialog.Title>
            <Dialog.Close
              type="button"
              className={buttonClass("ghost", { className: "dialog-close" })}
              aria-label="Close"
              disabled={state.busy}
            >
              ×
            </Dialog.Close>
          </div>
          {dialog && definition?.render(dialog)}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

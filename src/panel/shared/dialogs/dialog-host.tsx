import {
  Dialog,
  type DialogRootChangeEventDetails,
} from "@base-ui/react/dialog";
import { useLayoutEffect, useRef } from "react";

import { useController, useSnapshot } from "../../app/state/controller-context";
import type { DialogState } from "../../app/state/types";
import { buttonClass } from "../components/button/button";
import { useAnimatedHeight } from "../components/motion/motion";
import { dialogDefinition } from "./dialog-registry";

function isSettingsPageDialog(
  dialog?: DialogState,
): dialog is Extract<DialogState, { kind: "settings" | "settings-loading" }> {
  return dialog?.kind === "settings" || dialog?.kind === "settings-loading";
}

export function DialogHost({ suspended = false }: { suspended?: boolean }) {
  const controller = useController(),
    state = useSnapshot(),
    // The closing animation keeps showing the last dialog rather than an empty box.
    lastDialog = useRef(
      isSettingsPageDialog(state.dialog) ? undefined : state.dialog,
    );

  const settingsPageDialog = isSettingsPageDialog(state.dialog);

  const activeDialog = isSettingsPageDialog(state.dialog)
    ? undefined
    : state.dialog;

  if (activeDialog) lastDialog.current = activeDialog;

  const dialog =
    activeDialog ?? (settingsPageDialog ? undefined : lastDialog.current);

  const definition = dialog && dialogDefinition(dialog);

  const trigger = useRef<HTMLElement | null>(null),
    openedScope = useRef(0),
    popup = useRef<HTMLDivElement>(null),
    previousKind = useRef(activeDialog?.kind);

  // Replacing a dialog's contents keeps the popup open, so Base UI's opening
  // focus does not run again. Focus the replacement form or restored preview.
  useLayoutEffect(() => {
    const currentDialog = isSettingsPageDialog(state.dialog)
      ? undefined
      : state.dialog;

    const previous = previousKind.current;
    previousKind.current = currentDialog?.kind;

    const continuingAsyncForm =
      previous === "delegate-loading" && currentDialog?.kind === "delegate";

    if (
      !currentDialog ||
      !previous ||
      currentDialog.kind === previous ||
      continuingAsyncForm ||
      suspended
    ) {
      return;
    }

    const focus =
      definition?.initialFocus?.(popup.current, currentDialog) ??
      popup.current?.querySelector<HTMLElement>(
        "button:not([disabled]), input, textarea, [tabindex='0']",
      ) ??
      popup.current;

    focus?.focus();
  }, [state.dialog, definition, suspended]);

  // Switching forms or showing an error eases the height instead of snapping it.
  useAnimatedHeight(popup, `${dialog?.kind}:${state.formError}`);

  const handleOpenChange = (
    open: boolean,
    details: DialogRootChangeEventDetails,
  ) => {
    if (state.busy) details.cancel();
    else if (!open) controller.dismiss();
  };

  const handleInitialFocus = () => {
    trigger.current = document.activeElement as HTMLElement | null;
    openedScope.current = dialog?.scope ?? 0;

    return (
      (dialog && definition?.initialFocus?.(popup.current, dialog)) || true
    );
  };

  const handleFinalFocus = () => {
    if (suspended) return document.getElementById("open-panel");

    if (openedScope.current !== controller.getSnapshot().scopeVersion) {
      return document.getElementById(
        controller.getSnapshot().page === "projects"
          ? "project-add"
          : "delegate",
      );
    }

    if (trigger.current?.isConnected) return trigger.current;

    return definition?.restoreFocus?.() ?? document.getElementById("delegate");
  };

  return (
    // Host collapse hides the modal; keeping its contents mounted retains drafts.
    <Dialog.Root
      open={Boolean(activeDialog) && !suspended}
      disablePointerDismissal
      onOpenChange={handleOpenChange}
    >
      <Dialog.Portal keepMounted={Boolean(activeDialog)}>
        <Dialog.Backdrop className="dialog-overlay" />
        <Dialog.Popup
          ref={popup}
          id="dialog"
          className="dialog"
          data-kind={dialog?.kind}
          aria-describedby={undefined}
          initialFocus={handleInitialFocus}
          finalFocus={handleFinalFocus}
        >
          <div className="dialog-heading">
            <Dialog.Title id="dialog-title">
              {dialog && definition?.title(dialog)}
            </Dialog.Title>
            {dialog && definition?.headingActions?.(dialog)}
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

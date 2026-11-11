import {
  Dialog,
  type DialogRootChangeEventDetails,
} from "@base-ui/react/dialog";
import { useLayoutEffect, useRef } from "react";

import { isSettingsPageDialog } from "../../app/navigation/pages";
import { useController, useSnapshot } from "../../app/state/controller-context";
import { buttonClass } from "../components/button/button";
import { Icon } from "../components/icons/icons";
import { useAnimatedHeight } from "../components/motion/use-animated-height";
import { dialogDefinition } from "./dialog-registry";

export function DialogHost({ suspended = false }: { suspended?: boolean }) {
  const controller = useController();

  const { dialog, formError, busy } = useSnapshot([
    "dialog",
    "formError",
    "busy",
  ]);

  // The closing animation keeps showing the last dialog rather than an empty box.
  const lastDialog = useRef(isSettingsPageDialog(dialog) ? undefined : dialog);

  const settingsPageDialog = isSettingsPageDialog(dialog);

  const activeDialog = isSettingsPageDialog(dialog) ? undefined : dialog;

  if (activeDialog) lastDialog.current = activeDialog;

  const shownDialog =
    activeDialog ?? (settingsPageDialog ? undefined : lastDialog.current);

  const definition = shownDialog && dialogDefinition(shownDialog);

  const trigger = useRef<HTMLElement | null>(null),
    openedScope = useRef(0),
    popup = useRef<HTMLDivElement>(null),
    previousKind = useRef(activeDialog?.kind);

  // Replacing a dialog's contents keeps the popup open, so Base UI's opening
  // focus does not run again. Focus the replacement form or restored preview.
  useLayoutEffect(() => {
    const currentDialog = isSettingsPageDialog(dialog) ? undefined : dialog;

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
  }, [dialog, definition, suspended]);

  // Switching forms or showing an error eases the height instead of snapping it.
  useAnimatedHeight(popup, `${shownDialog?.kind}:${formError}`);

  const handleOpenChange = (
    open: boolean,
    details: DialogRootChangeEventDetails,
  ) => {
    if (busy) details.cancel();
    else if (!open) controller.dismiss();
  };

  const handleInitialFocus = () => {
    trigger.current = document.activeElement as HTMLElement | null;
    openedScope.current = shownDialog?.scope ?? 0;

    return (
      (shownDialog && definition?.initialFocus?.(popup.current, shownDialog)) ||
      true
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
          data-kind={shownDialog?.kind}
          aria-describedby={undefined}
          initialFocus={handleInitialFocus}
          finalFocus={handleFinalFocus}
        >
          <div className="dialog-heading">
            <Dialog.Title id="dialog-title">
              {shownDialog && definition?.title(shownDialog)}
            </Dialog.Title>
            {shownDialog && definition?.headingActions?.(shownDialog)}
            <Dialog.Close
              type="button"
              className={buttonClass("ghost", { className: "dialog-close" })}
              aria-label="Close"
              disabled={busy}
            >
              <Icon name="close" size={10} />
            </Dialog.Close>
          </div>
          {shownDialog && definition?.render(shownDialog)}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

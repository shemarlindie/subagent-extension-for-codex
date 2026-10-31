import { useEffect } from "react";

import { useController } from "./state/controller-context";

/** Fields whose own undo the shortcuts leave alone. */
const TEXT_ENTRY =
  "textarea, select, [contenteditable]:not([contenteditable='false']), input:not([type='checkbox'], [type='radio'], [type='button'], [type='submit'], [type='reset'], [type='range'], [type='color'], [type='file'])";

/** Which history step a key press asks for, if any. */
function undoShortcut(event: KeyboardEvent): "undo" | "redo" | undefined {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return undefined;
  const key = event.key.toLowerCase();

  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && event.ctrlKey && !event.shiftKey) return "redo";

  return undefined;
}

/**
 * Undoes and redoes the user's panel changes with Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z
 * and Ctrl+Y. Text fields, open dialogs and the Settings page keep their own
 * undo.
 */
export function useUndoShortcuts() {
  const controller = useController();

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const step = undoShortcut(event);

      if (
        !step ||
        event.defaultPrevented ||
        controller.getSnapshot().dialog ||
        // Settings keeps its own draft, so Cmd+Z there means its fields.
        controller.getSnapshot().page === "settings" ||
        (event.target instanceof Element && event.target.closest(TEXT_ENTRY))
      ) {
        return;
      }

      event.preventDefault();

      controller.run(() =>
        step === "undo" ? controller.undo.undo() : controller.undo.redo(),
      );
    };

    document.addEventListener("keydown", handle);

    return () => document.removeEventListener("keydown", handle);
  }, [controller]);
}

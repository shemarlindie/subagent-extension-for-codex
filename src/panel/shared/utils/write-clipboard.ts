/** Whether the Clipboard API exists; browsers omit it outside secure contexts. */
export const hasClipboardApi = () =>
  typeof (navigator.clipboard as Clipboard | undefined)?.writeText ===
  "function";

/** Writes from a user action, including hosts that restrict the Clipboard API. */
export async function writeClipboardText(text: string): Promise<void> {
  if (hasClipboardApi()) {
    try {
      await navigator.clipboard.writeText(text);

      return;
    } catch {
      // Embedded hosts can expose the API while denying clipboard-write.
    }
  }

  const focused = document.activeElement,
    selection = document.getSelection(),
    ranges = selection
      ? Array.from({ length: selection.rangeCount }, (_, i) =>
          selection.getRangeAt(i).cloneRange(),
        )
      : [],
    field = document.createElement("textarea");

  field.value = text;
  field.readOnly = true;
  field.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.append(field);

  try {
    field.focus({ preventScroll: true });
    field.select();

    // Native copy remains available in some hosts without clipboard-write.
    // execCommand is deprecated but has no replacement for that case.
    /* eslint-disable @typescript-eslint/no-deprecated */
    if (
      typeof document.execCommand === "function" &&
      document.execCommand("copy")
    ) {
      return;
    }
    /* eslint-enable @typescript-eslint/no-deprecated */
  } catch {
    // A host may block native copy too; offer manual selection below.
  } finally {
    field.remove();
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
    selection?.removeAllRanges();
    for (const range of ranges) selection?.addRange(range);
  }

  throw new Error("Couldn’t copy. Select the value and copy it manually.");
}

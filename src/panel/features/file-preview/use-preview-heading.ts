import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Fits a preview's file row beside its dialog's heading controls, which
 * overlay the row so the file's name takes the title's place. Returns where
 * the preview options go.
 */
export function usePreviewHeading(root: RefObject<HTMLElement | null>) {
  const [optionsTarget, setOptionsTarget] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const dialog = root.current?.closest<HTMLElement>(".dialog");

    const actions = dialog?.querySelector<HTMLElement>(
      ".file-preview-heading-actions",
    );

    setOptionsTarget(
      dialog?.querySelector<HTMLElement>("[data-file-preview-options]") ?? null,
    );

    if (!dialog || !actions || typeof ResizeObserver === "undefined") return;

    // The file row keeps room for the controls as their width changes.
    const observer = new ResizeObserver(() =>
      dialog.style.setProperty(
        "--heading-actions-width",
        `${actions.offsetWidth}px`,
      ),
    );

    observer.observe(actions);

    return () => {
      observer.disconnect();
      dialog.style.removeProperty("--heading-actions-width");
    };
  }, [root]);

  return optionsTarget;
}

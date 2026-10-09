/** Marks each changed file's section with its path, so a position can name it. */
export const FILE_ATTRIBUTE = "data-changed-file";

export type ChangesPosition = {
  /** The scroller's offset when the anchor is gone. */
  top: number;
  /** The first visible file and its top edge relative to the scroller's. */
  anchor?: { path: string; top: number };
};

/**
 * Where the reader was in a task's changes. The Changes tab unmounts while
 * hidden, so this is kept by the owner and mutated without rendering.
 */
export type ChangesReading = {
  position?: ChangesPosition;
  /** Files the reader opened or closed, by path. */
  open: Map<string, boolean>;
};

function files(viewport: HTMLElement) {
  return viewport.querySelectorAll<HTMLElement>(`[${FILE_ATTRIBUTE}]`);
}

/** The reader's place: the first file still showing at the scroller's top. */
export function measurePosition(
  viewport: HTMLElement,
  container: HTMLElement,
): ChangesPosition {
  const top = container.getBoundingClientRect().top;

  for (const file of files(viewport)) {
    const rect = file.getBoundingClientRect();

    if (rect.bottom > top)
      return {
        top: container.scrollTop,
        anchor: {
          path: file.getAttribute(FILE_ATTRIBUTE)!,
          top: rect.top - top,
        },
      };
  }

  return { top: container.scrollTop };
}

/**
 * Scrolls back to a saved place. The anchor file corrects the offset, since
 * the files above it may have changed or measure differently than before.
 */
export function restorePosition(
  viewport: HTMLElement,
  container: HTMLElement,
  position: ChangesPosition,
) {
  container.scrollTop = position.top;

  const { anchor } = position,
    file =
      anchor &&
      [...files(viewport)].find(
        (file) => file.getAttribute(FILE_ATTRIBUTE) === anchor.path,
      );

  if (anchor && file)
    container.scrollTop +=
      file.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      anchor.top;
}

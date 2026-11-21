const rowFor = (list: HTMLElement, id: string) =>
  list.querySelector<HTMLElement>(`[data-task="${CSS.escape(id)}"]`);

/**
 * Runs `action`, which can take task `id`'s row off `list`. If the row takes
 * focus with it, focus moves at once to the next row the list showed, the
 * previous one, or `fallback`. If the action fails and the row returns, focus
 * follows it back unless the user has moved it.
 */
export async function keepRowFocus(
  list: HTMLElement,
  id: string,
  fallback: HTMLElement | null,
  action: () => Promise<unknown>,
) {
  const page = list.ownerDocument;

  const ids = Array.from(
    list.querySelectorAll<HTMLElement>("[data-task]"),
    (row) => row.dataset.task ?? "",
  );

  const index = ids.indexOf(id);

  const neighbours = [
    ...ids.slice(index + 1),
    ...ids.slice(0, index).reverse(),
  ];

  const lost = () => !page.activeElement || page.activeElement === page.body;
  let moved: HTMLElement | null | undefined;

  const observer = new MutationObserver(() => {
    if (rowFor(list, id) || !lost()) return;

    observer.disconnect();

    const next = neighbours.find((other) => rowFor(list, other));
    moved = next === undefined ? fallback : rowFor(list, next);

    moved?.focus();
  });

  observer.observe(list, { childList: true, subtree: true });

  try {
    await action();
  } finally {
    observer.disconnect();
    const row = rowFor(list, id);

    if (row && page.activeElement === moved) row.focus();
  }
}

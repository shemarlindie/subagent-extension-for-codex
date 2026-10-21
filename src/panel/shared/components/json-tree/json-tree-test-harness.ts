import { fireEvent } from "@testing-library/react";

/**
 * The text of the JSON tree inside `container` with every branch expanded,
 * which parses as JSON, or undefined when no tree renders.
 */
export function expandedJsonText(container: Element) {
  const tree = container.querySelector(".json-tree");
  if (!tree) return undefined;

  for (
    let toggle = tree.querySelector('.json-toggle[aria-expanded="false"]');
    toggle;
    toggle = tree.querySelector('.json-toggle[aria-expanded="false"]')
  ) {
    fireEvent.click(toggle);
  }

  return tree.textContent;
}

/** The value the JSON tree inside `container` shows, fully expanded. */
export function expandedJson(container: Element): unknown {
  const text = expandedJsonText(container);

  return text === undefined ? undefined : JSON.parse(text);
}

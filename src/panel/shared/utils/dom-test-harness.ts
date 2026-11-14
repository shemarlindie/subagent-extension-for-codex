/** The first element matching `selector`, failing the test when there is none. */
export function getElement<E extends Element = Element>(
  parent: ParentNode,
  selector: string,
) {
  const element = parent.querySelector<E>(selector);
  if (!element) throw new Error(`No element matches ${selector}`);

  return element;
}

/** The element a control names in `aria-controls`. */
export function controlledElement(control: Element) {
  const id = control.getAttribute("aria-controls");
  const element = id && document.getElementById(id);
  if (!element) throw new Error(`No element has the id "${id}"`);

  return element;
}

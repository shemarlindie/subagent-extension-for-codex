import { useSyncExternalStore } from "react";

const STORAGE_KEY = "dw_hide_task_row_icons";

function stored() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "true";
  } catch {
    return true;
  }
}

let shown = stored();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

/** Shows or hides task rows' worker icons. Lasts for the session without storage. */
export function setRowIcons(next: boolean) {
  shown = next;

  try {
    if (next) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // The choice still applies until the panel reloads.
  }

  listeners.forEach((listener) => listener());
}

/**
 * Whether task rows show worker icons, which they do by default. Browser
 * storage keeps the choice across reloads wherever it is available.
 */
export function useRowIcons() {
  return useSyncExternalStore(subscribe, () => shown);
}

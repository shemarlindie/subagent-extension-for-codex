import { useSyncExternalStore } from "react";

const STORAGE_KEY = "dw_compact_task_rows";

function stored() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

let compact = stored();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

/** Shows each task row on one line. Lasts for the session without storage. */
export function setCompactRows(next: boolean) {
  compact = next;

  try {
    if (next) localStorage.setItem(STORAGE_KEY, "true");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // The choice still applies until the panel reloads.
  }

  listeners.forEach((listener) => listener());
}

/**
 * Whether task rows show on one line. Browser storage keeps the choice across
 * reloads wherever it is available.
 */
export function useCompactRows() {
  return useSyncExternalStore(subscribe, () => compact);
}

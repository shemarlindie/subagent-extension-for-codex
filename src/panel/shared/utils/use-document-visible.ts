import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  document.addEventListener("visibilitychange", listener);

  return () => document.removeEventListener("visibilitychange", listener);
}

const visible = () => !document.hidden;

/** Whether the page is on screen: false while its tab, window or host panel is hidden. */
export function useDocumentVisible() {
  return useSyncExternalStore(subscribe, visible, visible);
}

import { useSyncExternalStore } from "react";

import { visualThemeCss } from "./visual-document";

const root = () => document.documentElement;

/**
 * Hosts and the standalone panel's color scheme both restyle the panel
 * through the root's attributes.
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(root(), { attributes: true });

  return () => observer.disconnect();
}

/** The panel's current theme as CSS for a visual. */
export const useVisualTheme = () =>
  useSyncExternalStore(subscribe, () => visualThemeCss(root()));

import { useEffect, useState } from "react";

import { nextExpiryChange, signInExpiry } from "./sign-in-expiry";

const HIDDEN_UNTIL_KEY = "dw_sign_in_expiry_hidden_until";
const HIDE_MS = 86_400_000;
/** Browsers fire longer timeouts at once, so a far deadline waits in steps. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** When a dismissal ends, or 0 when browser storage has none. */
function storedHiddenUntil() {
  try {
    return Number(localStorage.getItem(HIDDEN_UNTIL_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * The warning for a sign-in ending at `expiresAt`, kept current as time passes,
 * and whether the viewer dismissed it. A dismissal lasts a day and applies to
 * every panel open in the same browser.
 */
export function useSignInExpiry(expiresAt: string | undefined) {
  const [hiddenUntil, setHiddenUntil] = useState(storedHiddenUntil);
  const [now, setNow] = useState(Date.now);

  const next = Math.min(
    nextExpiryChange(expiresAt, now) ?? Infinity,
    hiddenUntil > now ? hiddenUntil : Infinity,
  );

  // Renders again when the warning or a dismissal should change. A deadline
  // already past, such as with a new date after a long while open, fires at once.
  useEffect(() => {
    if (next === Infinity) return;

    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(next - Date.now(), MAX_TIMEOUT_MS),
    );

    return () => clearTimeout(timer);
  }, [next, now]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === HIDDEN_UNTIL_KEY) setHiddenUntil(storedHiddenUntil());
    };

    window.addEventListener("storage", sync);

    return () => window.removeEventListener("storage", sync);
  }, []);

  const dismiss = () => {
    const until = Date.now() + HIDE_MS;
    setHiddenUntil(until);

    try {
      localStorage.setItem(HIDDEN_UNTIL_KEY, String(until));
    } catch {
      // The dismissal still lasts while the panel stays open.
    }
  };

  return {
    expiry: signInExpiry(expiresAt, now),
    hidden: now < hiddenUntil,
    dismiss,
  };
}

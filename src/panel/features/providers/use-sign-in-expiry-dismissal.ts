import { useEffect, useState } from "react";

const HIDDEN_UNTIL_KEY = "dw_sign_in_expiry_hidden_until";
const HIDE_MS = 86_400_000;

/** When a dismissal ends, or 0 when browser storage has none. */
function storedHiddenUntil() {
  try {
    return Number(localStorage.getItem(HIDDEN_UNTIL_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Whether the viewer dismissed the sign-in warning. A dismissal lasts a day and
 * applies to every panel open in the same browser.
 */
export function useSignInExpiryDismissal() {
  const [hiddenUntil, setHiddenUntil] = useState(storedHiddenUntil);

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

  return { hidden: Date.now() < hiddenUntil, dismiss };
}

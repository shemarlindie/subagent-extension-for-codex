import { useEffect, useState } from "react";

const hiddenUntilKey = (provider: string) =>
  `dw_sign_in_expiry_hidden_until:${provider}`;

const HIDE_MS = 86_400_000;

/** When a dismissal ends, or 0 when browser storage has none. */
function storedHiddenUntil(key: string) {
  try {
    return Number(localStorage.getItem(key)) || 0;
  } catch {
    return 0;
  }
}

/**
 * Whether the viewer dismissed a provider's sign-in warning. A dismissal lasts
 * a day and applies to every panel open in the same browser.
 */
export function useSignInExpiryDismissal(provider: string) {
  const key = hiddenUntilKey(provider);
  const [hiddenUntil, setHiddenUntil] = useState(() => storedHiddenUntil(key));

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key) setHiddenUntil(storedHiddenUntil(key));
    };

    window.addEventListener("storage", sync);

    return () => window.removeEventListener("storage", sync);
  }, [key]);

  const dismiss = () => {
    const until = Date.now() + HIDE_MS;
    setHiddenUntil(until);

    try {
      localStorage.setItem(key, String(until));
    } catch {
      // The dismissal still lasts while the panel stays open.
    }
  };

  return { hidden: Date.now() < hiddenUntil, dismiss };
}

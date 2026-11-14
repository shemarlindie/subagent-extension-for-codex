import { useEffect, useState } from "react";

/**
 * The current time, refreshed every second while `active` and before
 * `until`; idle otherwise.
 */
export function useNow(active: boolean, until = Infinity) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    if (Date.now() >= until) return;

    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) clearInterval(timer);
    }, 1000);

    return () => clearInterval(timer);
  }, [active, until]);

  return now;
}

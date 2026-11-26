import { useRef, useState } from "react";

/**
 * Runs an async action one at a time, such as opening a file, and drops calls
 * made while it runs. `pending` is true until it settles. The action handles
 * its own errors.
 */
export function useSingleFlight() {
  const [pending, setPending] = useState(false);
  const running = useRef(false);

  const run = (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setPending(true);

    const done = () => {
      running.current = false;
      setPending(false);
    };

    action().then(done, done);
  };

  return [pending, run] as const;
}

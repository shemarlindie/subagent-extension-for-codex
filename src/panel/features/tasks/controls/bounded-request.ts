/** How a bounded call settled, observed separately from the panel's wait. */
export type SettledCall = {
  outcome: "success" | "error";
  /** Whether the bound expired first and the panel stopped waiting. */
  ui_timed_out: boolean;
};

/**
 * Limits how long the panel waits for an action, without assuming the service
 * cancelled it. The timeout rejects with `timeoutMessage`, which should tell
 * the user how to check the action's outcome. `settled` receives the call's
 * full duration once it ends, even after the timeout.
 */
export async function boundedRequest<T>(
  request: () => Promise<T>,
  timeoutMessage: string,
  settled: (durationMs: number, call: SettledCall) => void,
  timeoutMs = 30000,
): Promise<T> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const report = (outcome: SettledCall["outcome"]) => {
    try {
      settled(performance.now() - started, { outcome, ui_timed_out: timedOut });
    } catch {
      // Observing the call never changes its result or error.
    }
  };

  const pending = request().then(
    (value) => {
      report("success");

      return value;
    },
    (error: unknown) => {
      report("error");
      throw error;
    },
  );

  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

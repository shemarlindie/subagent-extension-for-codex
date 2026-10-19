/**
 * Limits how long the panel waits for an action, without assuming the service
 * cancelled it. The timeout rejects with `timeoutMessage`, which should tell
 * the user how to check the action's outcome. `settled` receives the call's
 * full duration once it ends, even after the timeout.
 */
export async function boundedRequest<T>(
  request: () => Promise<T>,
  timeoutMessage: string,
  settled: (durationMs: number) => void,
  timeoutMs = 30000,
): Promise<T> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const pending = request().finally(() => {
    settled(performance.now() - started);
  });

  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

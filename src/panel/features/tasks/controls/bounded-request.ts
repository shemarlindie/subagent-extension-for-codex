/**
 * Limits how long the panel waits for an action, without assuming the service
 * cancelled it. The timeout rejects with `timeoutMessage`, which should tell
 * the user how to check the action's outcome.
 */
export async function boundedRequest<T>(
  name: string,
  request: () => Promise<T>,
  timeoutMessage: string,
  timeoutMs = 30000,
): Promise<T> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const pending = request().finally(() => {
    console.debug("task.timing", {
      phase: "transport",
      operation: name,
      duration_ms: performance.now() - started,
    });
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

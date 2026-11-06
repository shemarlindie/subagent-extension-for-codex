import { vi } from "vitest";

/**
 * Waits for a condition during a test. The limit only stops a test that's
 * already broken, so it sits far above what a busy machine could need.
 */
export async function until(done: () => boolean) {
  await vi.waitUntil(done, { timeout: 15_000, interval: 10 });
}

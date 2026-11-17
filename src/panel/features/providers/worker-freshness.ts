import type { Worker } from "./types";

/** How long a ready worker list is reused, as long as the service caches it. */
const WORKERS_FRESH_MS = 5 * 60_000;

/**
 * Whether workers read at `readAt` need reading again. Workers that are unready
 * or missing models retry each refresh, and the rest every five minutes.
 */
export const workersStale = (workers: Worker[], readAt: number) =>
  !workers.length ||
  workers.some(
    (worker) =>
      worker.readiness?.ready === false || worker.model_discovery_error,
  ) ||
  Date.now() - readAt >= WORKERS_FRESH_MS;

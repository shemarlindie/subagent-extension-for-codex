import { chmodSync, renameSync, statSync } from "node:fs";

/** Rotate inherited output only before launching with no current service lease. */
export function rotateStartupLog(path: string, leaseReleased: () => boolean) {
  try {
    if (!leaseReleased() || statSync(path).size < 5_000_000) return;
    chmodSync(path, 0o600);
    renameSync(path, `${path}.1`);
  } catch {
    // Retention is best effort and must never prevent service startup.
  }
}

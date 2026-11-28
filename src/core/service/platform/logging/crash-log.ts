import { writeSync } from "node:fs";

import { errorCategory } from "./error-metadata.js";

/** The async queue cannot flush during a fatal exception. Keep a safe marker on stderr. */
export function recordCrash(error: Error, origin: string) {
  try {
    writeSync(
      2,
      `${JSON.stringify({ timestamp: new Date().toISOString(), level: "error", event: "service.crashed", pid: process.pid, origin, error_category: errorCategory(error) })}\n`,
    );
  } catch {
    // Monitoring must preserve Node's normal fatal-exception behavior.
  }
}

import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { isProcessRunning } from "./process-info.js";

const activeLeases = new Set<string>();

export class ExistingServiceError extends Error {
  constructor(
    readonly pid: number,
    readonly lockFile: string,
    options?: ErrorOptions,
  ) {
    super("A live service already owns this data directory", options);
    this.name = "ExistingServiceError";
  }
}

/** One service owns a data directory. Restart recovery must never race a live worker. */
export function lease(data: string) {
  const file = join(data, "service.pid");

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 });
      activeLeases.add(file);

      return () => {
        try {
          if (
            existsSync(file) &&
            readFileSync(file, "utf8") === String(process.pid)
          ) {
            unlinkSync(file);
          }
        } finally {
          activeLeases.delete(file);
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(readFileSync(file, "utf8"));

      if (!Number.isSafeInteger(pid) || pid <= 0) {
        throw new Error("Invalid service lock; inspect before removing", {
          cause: error,
        });
      }

      const staleSelfPid = pid === process.pid && !activeLeases.has(file);

      if (!staleSelfPid && isProcessRunning(pid)) {
        throw new ExistingServiceError(pid, file, { cause: error });
      }

      const reclaim = join(data, "service-reclaim.lock");

      try {
        mkdirSync(reclaim, { mode: 0o700 });
      } catch {
        throw new Error(
          `Another launcher is reclaiming the service lock (${reclaim}); retry shortly`,
        );
      }

      try {
        // Recheck after exclusive reclamation: another launcher may already own it.
        if (readFileSync(file, "utf8") === String(pid)) unlinkSync(file);
      } finally {
        rmdirSync(reclaim);
      }
    }
  }

  throw new Error("Could not acquire service lock");
}

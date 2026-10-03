import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  rmdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
/** One service owns a data directory. Restart recovery must never race a live worker. */
export function lease(data: string) {
  const file = join(data, "service.pid");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 });
      return () => {
        if (
          existsSync(file) &&
          readFileSync(file, "utf8") === String(process.pid)
        )
          unlinkSync(file);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(readFileSync(file, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0)
        throw new Error("Invalid service lock; inspect before removing");
      try {
        process.kill(pid, 0);
        throw new Error("A live service already owns this data directory");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
        const reclaim = join(data, "service-reclaim.lock");
        try {
          mkdirSync(reclaim, { mode: 0o700 });
        } catch {
          throw new Error(
            "Another launcher is reclaiming the service lock; retry shortly",
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
  }
  throw new Error("Could not acquire service lock");
}

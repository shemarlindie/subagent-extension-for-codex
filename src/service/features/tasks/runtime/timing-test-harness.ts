import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { onTestFinished } from "vitest";

import { configureTimingLog, flushTimingLog } from "./timing.js";

export type TimingRecord = Record<string, unknown>;

/** Sends timing records to a temporary file for the rest of the test. */
export async function captureTiming() {
  const directory = await mkdtemp(join(tmpdir(), "task-timing-"));
  const path = join(directory, "timing.jsonl");
  configureTimingLog(path);

  onTestFinished(async () => {
    await flushTimingLog();
    configureTimingLog(undefined);
    await rm(directory, { recursive: true, force: true });
  });

  return {
    path,
    /** The records written so far, optionally of one phase. */
    async records(phase?: string): Promise<TimingRecord[]> {
      await flushTimingLog();

      const text = await readFile(path, "utf8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "";
          throw error;
        },
      );

      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TimingRecord)
        .filter((record) => phase === undefined || record.phase === phase);
    },
  };
}

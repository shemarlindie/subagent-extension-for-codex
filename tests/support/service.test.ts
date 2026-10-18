import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { stopService } from "./service.js";

let data: string;

afterEach(async () => {
  vi.useRealTimers();
  if (data) await rm(data, { recursive: true, force: true });
});

test("waits for forced termination before returning control to cleanup", async () => {
  data = await mkdtemp(join(tmpdir(), "stop-service-"));
  await writeFile(join(data, "service.pid"), "12345");
  let forced = false;
  let exited = false;

  vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
    if (signal === "SIGKILL") forced = true;

    if (signal === 0 && exited) {
      throw Object.assign(new Error("No such process"), { code: "ESRCH" });
    }

    return true;
  });

  vi.useFakeTimers();
  let settled = false;

  const stopped = stopService({ data }).then(() => {
    settled = true;
  });

  // The PID file read uses real I/O before the shutdown timers begin.
  await vi.waitFor(() =>
    expect(process.kill).toHaveBeenCalledWith(12345, "SIGTERM"),
  );

  await vi.advanceTimersByTimeAsync(5_000);
  expect(forced).toBe(true);
  expect(settled).toBe(false);

  exited = true;
  await vi.advanceTimersByTimeAsync(20);
  await stopped;
  expect(settled).toBe(true);
});

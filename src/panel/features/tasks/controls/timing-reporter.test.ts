import { expect, onTestFinished, test, vi } from "vitest";

import { TimingReporter } from "./timing-reporter";

function setup(tool = vi.fn(async () => ({}))) {
  vi.useFakeTimers();

  onTestFinished(() => {
    vi.useRealTimers();
  });

  let closed = false;

  const reporter = new TimingReporter({
    closed: () => closed,
    tool: tool as <T>(
      name: string,
      args: Record<string, unknown>,
    ) => Promise<T>,
  });

  return { tool, reporter, close: () => (closed = true) };
}

test("records wait briefly and go to the service in one batch", async () => {
  const { tool, reporter } = setup();

  reporter.record({ operation: "app_send_message", duration_ms: 12 });
  reporter.record({ operation: "app_send_message", duration_ms: 30 });
  expect(tool).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(5000);

  expect(tool).toHaveBeenCalledExactlyOnceWith("app_record_timing", {
    records: [
      { operation: "app_send_message", duration_ms: 12 },
      { operation: "app_send_message", duration_ms: 30 },
    ],
  });

  expect(vi.getTimerCount()).toBe(0);
});

test("a full batch goes at once, and a failed send drops its records", async () => {
  const { tool, reporter } = setup(
    vi.fn(async () => Promise.reject(new Error("offline"))),
  );

  for (let i = 0; i < 20; i++) {
    reporter.record({ operation: "app_send_message", duration_ms: i });
  }

  await vi.advanceTimersByTimeAsync(0);

  expect(tool).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);

  reporter.record({ operation: "app_send_message", duration_ms: 1 });
  await vi.advanceTimersByTimeAsync(5000);

  expect(tool).toHaveBeenLastCalledWith("app_record_timing", {
    records: [{ operation: "app_send_message", duration_ms: 1 }],
  });
});

test("a closed panel drops waiting records", async () => {
  const { tool, reporter, close } = setup();

  reporter.record({ operation: "app_send_message", duration_ms: 12 });
  close();
  reporter.record({ operation: "app_send_message", duration_ms: 30 });
  await vi.advanceTimersByTimeAsync(5000);

  expect(tool).not.toHaveBeenCalled();
});

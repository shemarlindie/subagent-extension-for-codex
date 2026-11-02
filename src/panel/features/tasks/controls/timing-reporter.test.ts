import { expect, onTestFinished, test, vi } from "vitest";

import { TimingReporter } from "./timing-reporter";

type ReportTool = (
  name: string,
  args: Record<string, unknown>,
) => Promise<object>;

function setup(tool = vi.fn<ReportTool>(async () => ({}))) {
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

  onTestFinished(() => reporter.dispose());

  return {
    tool,
    reporter,
    close: () => (closed = true),
  };
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
    vi.fn<ReportTool>(async () => Promise.reject(new Error("offline"))),
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
    dropped_count: 20,
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

test("a held report coalesces rapid polling and bounds pending calls", async () => {
  let release!: (value: object) => void;

  const held = new Promise<object>((resolve) => {
    release = resolve;
  });

  const { tool, reporter } = setup(vi.fn<ReportTool>(() => held));

  for (let i = 0; i < 20; i++) {
    reporter.record({ operation: "app_send_message", duration_ms: i });
  }

  await vi.advanceTimersByTimeAsync(0);
  expect(tool).toHaveBeenCalledOnce();

  for (let i = 0; i < 1000; i++) {
    reporter.record({ operation: "interrupt_task", duration_ms: 1 });
  }

  for (let i = 0; i < 10_000; i++) {
    reporter.observe("activity_latest", "decode", 2, { rows: 200 });
  }

  reporter.observe("activity_latest", "decode", 7, {
    rows: 1,
    outcome: "error",
  });

  reporter.observe("activity_latest", "merge", 0, { stale_count: 1 });

  await vi.advanceTimersByTimeAsync(60_000);
  expect(tool).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBeLessThanOrEqual(1);

  release({});
  await vi.advanceTimersByTimeAsync(5000);
  expect(tool).toHaveBeenCalledTimes(2);

  const batch = tool.mock.calls[1]?.[1] as {
    records: unknown[];
    dropped_count: number;
  };

  expect(batch.records).toHaveLength(22);
  expect(batch.dropped_count).toBe(980);

  expect(batch.records).toContainEqual({
    operation: "activity_latest",
    phase: "decode",
    count: 10_001,
    total_ms: 20_007,
    max_ms: 7,
    rows: 2_000_001,
    groups: 0,
    stale_count: 0,
    error_count: 1,
  });

  expect(batch.records).toContainEqual(
    expect.objectContaining({
      operation: "activity_latest",
      phase: "merge",
      count: 1,
      stale_count: 1,
    }),
  );
});

test("failed aggregates are dropped and their loss is carried by the next batch", async () => {
  const tool = vi.fn<ReportTool>(async () => ({}));

  tool.mockImplementationOnce(() => {
    throw new Error("offline");
  });

  const { reporter } = setup(tool);

  reporter.observe("chat", "fetch", 15, { rows: 2 });
  await vi.advanceTimersByTimeAsync(5000);
  reporter.observe("chat", "fetch", 3, { rows: 1 });
  await vi.advanceTimersByTimeAsync(5000);

  expect(tool).toHaveBeenCalledTimes(2);

  expect(tool.mock.calls[1]?.[1]).toEqual({
    records: [
      {
        operation: "chat",
        phase: "fetch",
        count: 1,
        total_ms: 3,
        max_ms: 3,
        rows: 1,
        groups: 0,
        stale_count: 0,
        error_count: 0,
      },
    ],
    dropped_count: 1,
  });
});

test("disposing while a report is held releases waiting work and cannot restart reporting", async () => {
  let release!: (value: object) => void;

  const held = new Promise<object>((resolve) => {
    release = resolve;
  });

  const { tool, reporter } = setup(vi.fn<ReportTool>(() => held));

  reporter.observe("task_list", "fetch", 1);
  await vi.advanceTimersByTimeAsync(5000);
  reporter.observe("activity_turn", "group", 4, { rows: 50, groups: 8 });
  reporter.dispose();
  reporter.observe("chat", "merge", 2);
  reporter.record({ operation: "interrupt_task", duration_ms: 1 });
  release({});
  await vi.advanceTimersByTimeAsync(60_000);

  expect(tool).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

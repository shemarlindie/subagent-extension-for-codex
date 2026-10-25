// @vitest-environment jsdom
import assert from "node:assert/strict";

import { expect, test, vi } from "vitest";

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";

import { startSchema } from "../../../../shared/tasks/model.js";
import type { Task } from "../../../app/state/types";
import { TaskRow } from "../list/task-list";
import { TaskDetails } from "./task-details";

const task = (patch: Partial<Task>): Task => ({
  ...startSchema.parse({
    repository: "/repo",
    title: "t",
    description: "t",
    worker_profile: "reviewer",
  }),
  id: "t",
  title: "t",
  owner: "o",
  repository: "/repo",
  status: "running",
  created_at: "",
  updated_at: "",
  instructions: [],
  created_by: "user",
  instructions_sent: 0,
  pending_steers: [],
  queue: [],
  turn: 1,
  runtime_ms: 60_000,
  ...patch,
});

const runtime = (view: ReturnType<typeof render>) =>
  [...view.container.querySelectorAll(".fact")]
    .find((fact) => fact.querySelector("dt")?.textContent === "Runtime used")
    ?.querySelector("dd")?.textContent;

test("a running task's runtime ticks and a finished task's stays fixed", (t) => {
  t.onTestFinished(() => {
    cleanup();
    vi.useRealTimers();
  });

  vi.useFakeTimers({ now: Date.parse("2026-10-02T12:00:30.000Z") });
  const running = task({ run_started_at: "2026-10-02T12:00:00.000Z" });
  const view = render(createElement(TaskDetails, { task: running }));
  assert.equal(runtime(view), "1m 30s");
  act(() => void vi.advanceTimersByTime(5000));
  assert.equal(runtime(view), "1m 35s");

  view.rerender(
    createElement(TaskDetails, {
      task: { ...running, status: "completed", runtime_ms: 95_000 },
    }),
  );

  act(() => void vi.advanceTimersByTime(5000));
  assert.equal(runtime(view), "1m 35s");
});

const row = (task: Task) =>
  createElement(TaskRow, {
    task,
    selected: false,
    onSelect() {},
    onToggleRead() {},
    onArchive() {},
  });

const rowRuntime = (view: ReturnType<typeof render>) =>
  view.container.querySelector(".row-runtime")?.textContent;

test("task list runtime ticks, freezes while stopped, and accumulates after resume", (t) => {
  t.onTestFinished(() => {
    cleanup();
    vi.useRealTimers();
  });

  vi.useFakeTimers({ now: Date.parse("2026-10-02T12:00:30.000Z") });
  const running = task({ run_started_at: "2026-10-02T12:00:00.000Z" });
  const view = render(row(running));
  assert.equal(rowRuntime(view), "1m 30s");
  act(() => void vi.advanceTimersByTime(5000));
  assert.equal(rowRuntime(view), "1m 35s");

  for (const status of ["waiting", "interrupted"] as const) {
    view.rerender(
      row(task({ status, runtime_ms: 95_000, run_started_at: undefined })),
    );

    const expected = status === "waiting" ? "Waiting" : "Interrupted";
    assert.equal(rowRuntime(view), expected);
    act(() => void vi.advanceTimersByTime(5000));
    assert.equal(rowRuntime(view), expected);
  }

  view.rerender(
    row(
      task({
        runtime_ms: 95_000,
        run_started_at: new Date(Date.now()).toISOString(),
      }),
    ),
  );

  assert.equal(rowRuntime(view), "1m 35s");
  act(() => void vi.advanceTimersByTime(5000));
  assert.equal(rowRuntime(view), "1m 40s");
});

test("task list freezes an open run when input is requested and catches up on resume", (t) => {
  t.onTestFinished(() => {
    cleanup();
    vi.useRealTimers();
  });

  vi.useFakeTimers({ now: Date.parse("2026-10-02T12:00:30.000Z") });
  const running = task({ run_started_at: "2026-10-02T12:00:00.000Z" });
  const view = render(row(running));
  assert.equal(rowRuntime(view), "1m 30s");

  view.rerender(
    row({
      ...running,
      status: "waiting",
      pending_input: {
        id: "question",
        kind: "question",
        tool: "AskUserQuestion",
        input: {},
      },
      updated_at: new Date(Date.now()).toISOString(),
    }),
  );

  assert.equal(rowRuntime(view), "Needs input");
  act(() => void vi.advanceTimersByTime(10_000));
  assert.equal(rowRuntime(view), "Needs input");
  view.rerender(row(running));
  assert.equal(rowRuntime(view), "1m 40s");
  act(() => void vi.advanceTimersByTime(5000));
  assert.equal(rowRuntime(view), "1m 45s");
});

test("task list shows a fixed final runtime for every terminal status, including zero", (t) => {
  t.onTestFinished(() => {
    cleanup();
    vi.useRealTimers();
  });

  vi.useFakeTimers();
  const view = render(row(task({ status: "completed" })));

  for (const status of ["completed", "failed"] as const) {
    for (const runtime_ms of [95_000, 0]) {
      view.rerender(row(task({ status, runtime_ms })));
      const expected = `Ran for ${runtime_ms ? "1m 35s" : "0s"}`;
      assert.equal(rowRuntime(view), expected);
      act(() => void vi.advanceTimersByTime(5000));
      assert.equal(rowRuntime(view), expected);
    }
  }
});

test("task list status icons expose each task state to assistive technology", (t) => {
  t.onTestFinished(cleanup);
  const view = render(row(task({})));

  const states: Array<[Partial<Task>, string]> = [
    [{ status: "queued" }, "Queued"],
    [{ status: "starting" }, "Starting"],
    [{ status: "running" }, "Running"],
    [{ status: "waiting" }, "Waiting"],
    [{ status: "interrupted" }, "Interrupted"],
    [{ status: "completed" }, "Completed"],
    [{ status: "failed" }, "Failed"],
    [
      {
        status: "running",
        pending_input: {
          id: "question",
          kind: "question",
          tool: "AskUserQuestion",
          input: {},
        },
      },
      "Needs input",
    ],
    [
      { status: "waiting", waiting_reason: "waiting_for_dependency" },
      "Waiting on dependency",
    ],
  ];

  for (const [patch, label] of states) {
    view.rerender(row(task(patch)));
    const icon = view.getByRole("img", { name: label });
    assert.ok(icon.classList.contains("row-status-icon"));
    assert.equal(icon.querySelector("title")?.textContent, label);
    assert.equal(view.getAllByRole("img").length, 1);
    if (label === "Needs input") assert.ok(icon.classList.contains("input"));

    if (label === "Interrupted") {
      assert.ok(icon.classList.contains("interrupted"));
    }
  }
});

test("task list icons describe the running task's latest activity", (t) => {
  t.onTestFinished(cleanup);
  const view = render(row(task({})));

  for (const [live_activity, kind, label] of [
    [
      { text: "Waiting for rate limit reset", state: "info" },
      "paused",
      "Waiting for rate limit reset",
    ],
    [
      { text: "Context compaction failed", state: "failed" },
      "failed",
      "Compaction failed",
    ],
  ] as const) {
    view.rerender(row(task({ live_activity })));
    const icon = view.getByRole("img", { name: label });
    assert.ok(icon.classList.contains(kind));
    assert.equal(icon.querySelector("title")?.textContent, label);

    if (kind === "failed") {
      assert.equal(rowRuntime(view), "Compaction failed");

      view.rerender(
        row(
          task({
            live_activity,
            run_started_at: new Date(Date.now() - 60_000).toISOString(),
          }),
        ),
      );

      assert.equal(rowRuntime(view), "Compaction failed");
    }
  }
});

test("terminal states and input requests take precedence over stale activity", (t) => {
  t.onTestFinished(cleanup);

  const live_activity = {
    text: "Context compaction failed",
    state: "failed" as const,
  };

  const view = render(row(task({ live_activity })));

  for (const status of ["completed", "failed"] as const) {
    view.rerender(row(task({ status, live_activity })));

    view.getByRole("img", {
      name: status.charAt(0).toUpperCase() + status.slice(1),
    });

    expect(view.queryByRole("img", { name: live_activity.text })).toBeNull();
  }

  view.rerender(
    row(
      task({
        status: "waiting",
        pending_input: {
          id: "question",
          kind: "question",
          tool: "AskUserQuestion",
          input: {},
        },
        live_activity,
      }),
    ),
  );

  assert.ok(
    view.getByRole("img", { name: "Needs input" }).classList.contains("input"),
  );

  expect(view.queryByRole("img", { name: live_activity.text })).toBeNull();
});

test("task list replaces its activity fallback with a live timer once the run starts", (t) => {
  t.onTestFinished(() => {
    cleanup();
    vi.useRealTimers();
  });

  vi.useFakeTimers({ now: Date.parse("2026-10-02T12:00:00.000Z") });

  const running = task({
    runtime_ms: 0,
    live_activity: { text: "Waiting for rate limit reset", state: "info" },
  });

  const view = render(row(running));
  assert.equal(rowRuntime(view), "Rate limit");

  view.rerender(
    row({ ...running, run_started_at: new Date(Date.now()).toISOString() }),
  );

  assert.equal(rowRuntime(view), "Rate limit");

  view.rerender(
    row({
      ...running,
      run_started_at: new Date(Date.now()).toISOString(),
      live_activity: { text: "Working", state: "running" },
    }),
  );

  assert.equal(rowRuntime(view), "0s");
  act(() => void vi.advanceTimersByTime(5000));
  assert.equal(rowRuntime(view), "5s");
  view.getByRole("img", { name: "Running" });
});

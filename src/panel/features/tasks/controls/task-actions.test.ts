import { assert, expect, onTestFinished, test, vi } from "vitest";

import { SendRejectedError } from "../../../../shared/tasks/conversation/send-errors";
import {
  deferred,
  flush,
  task,
} from "../../../app/state/controller-test-harness";
import type { Snapshot, Task } from "../../../app/state/types";
import { TaskActions } from "./task-actions";

function setup(
  tool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<unknown> = async () => {},
) {
  let state = { busy: false } as Snapshot;
  const busyChanges: boolean[] = [];

  const toolCall = vi.fn(tool);

  const context = {
    snapshot: () => state,
    closed: () => false,
    patch: (patch: Partial<Snapshot>) => {
      if (patch.busy !== undefined) busyChanges.push(patch.busy);
      state = { ...state, ...patch };
    },
    tool: toolCall as <T>(
      name: string,
      args: Record<string, unknown>,
    ) => Promise<T>,
    refresh: vi.fn(async () => {}),
    report: vi.fn(),
    forgetQuestion: vi.fn(),
    leaveSelection: vi.fn(),
  };

  return {
    actions: new TaskActions(context),
    context: { ...context, tool: toolCall },
    busyChanges,
    setBusy: (busy: boolean) => (state = { ...state, busy }),
  };
}

const question: Task = {
  ...task("task-1"),
  pending_input: {
    id: "request-1",
    tool: "AskUserQuestion",
    kind: "question",
    input: { questions: [] },
  },
};

test("a task action marks the panel busy, then reloads", async () => {
  const { actions, context, busyChanges } = setup();

  expect(await actions.resumeQueue(task("task-1"))).toBeUndefined();

  expect(context.tool).toHaveBeenCalledWith("app_resume_queue", {
    task_id: "task-1",
  });

  expect(busyChanges).toEqual([true, false]);
  expect(context.refresh).toHaveBeenCalledOnce();
});

test("a failed task action returns its message without reloading", async () => {
  const { actions, context, busyChanges } = setup(async () => {
    throw new Error("Queue is empty");
  });

  expect(await actions.clearQueue(task("task-1"))).toBe("Queue is empty");
  expect(busyChanges).toEqual([true, false]);
  expect(context.refresh).not.toHaveBeenCalled();
});

test("a task action waits for the last one to finish", async () => {
  const { actions, context, setBusy } = setup();
  setBusy(true);

  expect(await actions.sendMessage(task("task-1"), "Hi", "queue")).toBe(
    "Wait for the last action.",
  );

  expect(context.tool).not.toHaveBeenCalled();
});

test("sending acknowledges the write before a slow refresh finishes", async () => {
  const write = deferred<void>();
  const refresh = deferred<void>();
  const { actions, context, busyChanges } = setup(() => write.promise);
  context.refresh.mockReturnValue(refresh.promise);
  const completed = vi.fn();
  const sending = actions.sendMessage(task("task-1"), "Hi", "queue");
  void sending.then(completed);

  await flush();
  expect(completed).not.toHaveBeenCalled();
  expect(context.refresh).not.toHaveBeenCalled();
  expect(busyChanges).toEqual([true]);

  write.resolve();
  await flush();
  expect(completed).toHaveBeenCalledWith(undefined);
  expect(context.refresh).toHaveBeenCalledOnce();
  expect(busyChanges).toEqual([true, false]);

  refresh.resolve();
  await sending;
});

test("a send's duration goes to the service timing log in the background", async () => {
  vi.useFakeTimers();

  onTestFinished(() => {
    vi.useRealTimers();
  });

  const { actions, context } = setup();
  await actions.sendMessage(task("task-1"), "Hi", "queue");
  expect(context.tool).toHaveBeenCalledOnce();

  await vi.advanceTimersByTimeAsync(5000);

  expect(context.tool).toHaveBeenLastCalledWith("app_record_timing", {
    records: [
      {
        operation: "app_send_message",
        duration_ms: expect.any(Number),
        // The test task ID isn't a service ID, so only the send correlates.
        request_id: expect.stringMatching(/^[0-9a-f]{32}$/),
        outcome: "success",
        ui_timed_out: false,
      },
    ],
  });
});

test("a refresh failure after a send is reported without repeating the write", async () => {
  const refresh = deferred<void>();
  const { actions, context } = setup();
  context.refresh.mockReturnValue(refresh.promise);

  const sending = actions.sendMessage(task("task-1"), "Hi", "steer");
  const completed = vi.fn();
  void sending.then(completed);
  await flush();
  expect(completed).toHaveBeenCalledWith(undefined);

  const failure = new Error("Refresh unavailable");
  refresh.reject(failure);
  await flush();
  expect(context.report).toHaveBeenCalledWith(failure);
  expect(context.tool).toHaveBeenCalledOnce();
});

test("unconfirmed sends retain their request ID and delivery until acknowledged", async () => {
  const { actions, context } = setup();
  context.tool.mockRejectedValueOnce(new Error("Connection lost"));

  expect(await actions.sendMessage(task("task-1"), "Hi", "queue")).toBe(
    "Connection lost",
  );

  const original = context.tool.mock.calls[0];
  await actions.sendMessage(task("task-1"), "Hi", "steer");
  expect(context.tool.mock.calls[1]).toEqual(original);

  await actions.sendMessage(task("task-1"), "Hi", "steer");
  expect(context.tool.mock.calls[2]).not.toEqual(original);
  expect(context.tool.mock.calls[2]?.[1]).toMatchObject({ delivery: "steer" });
});

test("confirmed send rejection releases its request ID and delivery", async () => {
  const { actions, context } = setup();

  context.tool.mockRejectedValueOnce(
    new SendRejectedError("Worker is waiting for input"),
  );

  expect(await actions.sendMessage(task("task-1"), "Hi", "steer")).toBe(
    "Worker is waiting for input",
  );

  const original = context.tool.mock.calls[0]?.[1];
  await actions.sendMessage(task("task-1"), "Hi", "queue");
  const retried = context.tool.mock.calls[1]?.[1];
  expect(retried).toMatchObject({ delivery: "queue", message: "Hi" });
  expect(retried?.request_id).not.toBe(original?.request_id);
});

test("request IDs distinguish task and message", async () => {
  const { actions, context } = setup(async () => {
    throw new Error("Connection lost");
  });

  await actions.sendMessage(task("task-1"), "Hi", "queue");
  await actions.sendMessage(task("task-2"), "Hi", "queue");
  await actions.sendMessage(task("task-1"), "Changed", "queue");

  expect(
    new Set(context.tool.mock.calls.map((call) => call[1]?.request_id)).size,
  ).toBe(3);
});

test("a send timeout releases busy and a late acknowledgement leaves the retry busy", async () => {
  vi.useFakeTimers();

  onTestFinished(() => {
    vi.useRealTimers();
  });

  const original = deferred<void>();
  const retry = deferred<void>();
  const { actions, context, busyChanges } = setup(() => original.promise);
  const sending = actions.sendMessage(task("task-1"), "Hi", "queue");

  await vi.advanceTimersByTimeAsync(30000);
  expect(await sending).toContain("Delivery could not be confirmed");
  expect(busyChanges).toEqual([true, false]);

  context.tool.mockReturnValue(retry.promise);
  const retrying = actions.sendMessage(task("task-1"), "Hi", "steer");
  expect(context.tool.mock.calls[1]).toEqual(context.tool.mock.calls[0]);
  original.resolve();
  await flush();
  expect(busyChanges).toEqual([true, false, true]);
  expect(context.refresh).not.toHaveBeenCalled();

  retry.resolve();
  await retrying;
  expect(busyChanges).toEqual([true, false, true, false]);
});

test("the call outcome after a timeout ends the retry identity once", async () => {
  vi.useFakeTimers();

  onTestFinished(() => {
    vi.useRealTimers();
  });

  const late = deferred<void>();
  const delivered = vi.fn();
  const { actions, context } = setup(() => late.promise);
  const sending = actions.sendMessage(task("task-1"), "Hi", "queue", delivered);

  await vi.advanceTimersByTimeAsync(30000);
  await sending;
  expect(delivered).not.toHaveBeenCalled();

  late.reject(new SendRejectedError("Task was deleted"));
  await flush();
  expect(delivered).not.toHaveBeenCalled();

  context.tool.mockResolvedValue(undefined);
  await actions.sendMessage(task("task-1"), "Hi", "steer", delivered);
  expect(context.tool.mock.calls[1]?.[1]).toMatchObject({ delivery: "steer" });

  expect(context.tool.mock.calls[1]?.[1]?.request_id).not.toBe(
    context.tool.mock.calls[0]?.[1]?.request_id,
  );

  expect(delivered).toHaveBeenCalledOnce();
});

test("a stalled interrupt asks the user to check whether shutdown finished", async () => {
  vi.useFakeTimers();

  onTestFinished(() => {
    vi.useRealTimers();
  });

  const { actions, busyChanges } = setup(() => new Promise(() => {}));
  const stopping = actions.interruptTask(task("task-1"));

  await vi.advanceTimersByTimeAsync(30000);
  expect(await stopping).toContain("The current turn is still stopping");
  expect(busyChanges).toEqual([true, false]);
});

test("queue actions still wait for their refresh", async () => {
  const refresh = deferred<void>();
  const { actions, context } = setup();
  context.refresh.mockReturnValue(refresh.promise);
  const completed = vi.fn();
  const resuming = actions.resumeQueue(task("task-1"));
  void resuming.then(completed);

  await flush();
  expect(completed).not.toHaveBeenCalled();
  refresh.resolve();
  await resuming;
  expect(completed).toHaveBeenCalledWith(undefined);
});

test("a permission decision needs a pending permission request", async () => {
  const { actions, context } = setup();

  expect(await actions.decidePermission(question, true)).toBe(
    "The permission request is no longer available.",
  );

  expect(context.tool).not.toHaveBeenCalled();
});

test("permission decisions submit the request id and optional worker message", async () => {
  const { actions, context } = setup();

  const pending: Task = {
    ...task("task-1"),
    pending_input: {
      id: "request-1",
      tool: "Bash",
      kind: "permission",
      input: { command: "npm run typecheck" },
    },
  };

  expect(
    await actions.decidePermission(pending, true, "Run only the checks."),
  ).toBeUndefined();

  expect(context.tool).toHaveBeenCalledExactlyOnceWith("submit_input", {
    task_id: "task-1",
    request_id: "request-1",
    approved: true,
    message: "Run only the checks.",
  });
});

test("an answered question is forgotten before the task reloads", async () => {
  const { actions, context } = setup();

  expect(await actions.answer(question, { Pick: "A" })).toBeUndefined();

  expect(context.tool).toHaveBeenCalledWith("submit_input", {
    task_id: "task-1",
    request_id: "request-1",
    approved: true,
    input: { questions: [], answers: { Pick: "A" } },
  });

  expect(context.forgetQuestion).toHaveBeenCalledWith("request-1");

  const [forgotten] = context.forgetQuestion.mock.invocationCallOrder;
  const [refreshed] = context.refresh.mock.invocationCallOrder;
  assert(forgotten !== undefined && refreshed !== undefined);
  expect(forgotten).toBeLessThan(refreshed);
});

test("an answer sent while busy does nothing", async () => {
  const { actions, context, setBusy } = setup();
  setBusy(true);

  expect(await actions.answer(question, { Pick: "A" })).toBeUndefined();
  expect(context.tool).not.toHaveBeenCalled();
});

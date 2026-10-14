import { assert, expect, test, vi } from "vitest";

import { task } from "../../../app/state/controller-test-harness";
import type { Snapshot, Task } from "../../../app/state/types";
import { TaskActions } from "./task-actions";

function setup(tool: (name: string) => Promise<unknown> = async () => {}) {
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
    tool: toolCall as <T>(name: string) => Promise<T>,
    refresh: vi.fn(async () => {}),
    report: vi.fn(),
    forgetQuestion: vi.fn(),
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

  expect(context.tool).toHaveBeenCalledWith("resume_user_agent_queue", {
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

test("a permission decision needs a pending permission request", async () => {
  const { actions, context } = setup();

  expect(await actions.decidePermission(question, true)).toBe(
    "The permission request is no longer available.",
  );

  expect(context.tool).not.toHaveBeenCalled();
});

test("an answered question is forgotten before the task reloads", async () => {
  const { actions, context } = setup();

  expect(await actions.answer(question, { Pick: "A" })).toBeUndefined();

  expect(context.tool).toHaveBeenCalledWith("submit_agent_input", {
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

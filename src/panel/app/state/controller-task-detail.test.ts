import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { decodedEvent } from "../../../shared/events/decode";
import {
  windowActivity,
  windowTurnActivity,
} from "../../../shared/tasks/activity/activity-tail";
import { deferred, flush, setup, task } from "./controller-test-harness";
import type { Event } from "./types";

test("selected activity loading clears independently from chat history", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());

  const selected = task("task-1", "/repo/a", "thread-one");

  transport.context = {
    panel_scope: { conversation_id: "thread-one" },
  };

  const tasksRead = deferred<unknown>();
  const activityRead = deferred<unknown>();
  const chatRead = deferred<unknown>();

  transport.handler = (name) => {
    if (name === "list_agent_tasks") return tasksRead.promise;
    if (name === "get_user_agent_activity") return activityRead.promise;
    if (name === "get_user_agent_chat") return chatRead.promise;

    return undefined;
  };

  assert.equal(controller.getSnapshot().taskListLoading, true);
  const starting = controller.start();
  await flush();
  assert.equal(controller.getSnapshot().taskListLoading, true);

  tasksRead.resolve([selected]);
  await flush();
  assert.equal(controller.getSnapshot().taskListLoading, false);
  assert.equal(controller.getSnapshot().selected, selected.id);
  assert.equal(controller.getSnapshot().chatHistoryLoading, selected.id);
  assert.equal(controller.getSnapshot().activityHistoryLoading, selected.id);

  activityRead.resolve({ events: [] });
  await flush();
  assert.equal(controller.getSnapshot().activityHistoryLoading, undefined);
  assert.equal(controller.getSnapshot().chatHistoryLoading, selected.id);

  chatRead.resolve({ items: [], next_cursor: 0 });
  await starting;
  assert.equal(controller.getSnapshot().chatHistoryLoading, undefined);
});

test("selected chat history becomes available while activity is still loading", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());

  const selected = task("task-1", "/repo/a", "thread-one");
  transport.tasks = [selected];

  transport.context = {
    panel_scope: { conversation_id: "thread-one" },
  };

  const activityRead = deferred<unknown>();
  const chatRead = deferred<unknown>();

  transport.handler = (name) => {
    if (name === "get_user_agent_activity") return activityRead.promise;
    if (name === "get_user_agent_chat") return chatRead.promise;

    return undefined;
  };

  const starting = controller.start();
  await flush();

  chatRead.resolve({ items: [], next_cursor: 0 });
  await flush();
  assert.equal(controller.getSnapshot().chat?.task, selected.id);
  assert.equal(controller.getSnapshot().chatHistoryLoading, undefined);
  assert.equal(controller.getSnapshot().activityHistoryLoading, selected.id);

  activityRead.resolve({ events: [] });
  await starting;
  assert.equal(controller.getSnapshot().activityHistoryLoading, undefined);
});

test("delayed detail from a previous selection cannot replace current events", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a"), task("b")];
  await controller.start();
  const gate = deferred<unknown>();

  transport.handler = (name, args) => {
    if (name === "get_user_agent_activity" && args.task_id === "a") {
      return gate.promise;
    }

    if (name === "get_user_agent_activity") {
      return {
        events: [{ id: 2, task_id: "b", type: "log", timestamp: "", data: {} }],
      };
    }

    return undefined;
  };

  const first = controller.select("a");
  await controller.select("b");

  gate.resolve({
    events: [{ id: 1, task_id: "a", type: "log", timestamp: "", data: {} }],
  });

  await first;
  assert.equal(controller.getSnapshot().selected, "b");

  assert.deepEqual(
    controller.getSnapshot().events.map((item) => item.task_id),
    ["b"],
  );
});

test("the activity view shows the service's window and its tally, and polls for new events", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];
  await controller.start();

  const events = Array.from({ length: 1005 }, (_, i) =>
    decodedEvent({
      id: i + 1,
      task_id: "a",
      type: "log",
      timestamp: "",
      data: {},
    }),
  );

  transport.handler = (name, args) =>
    name === "get_user_agent_activity"
      ? windowActivity(events, Number(args.after))
      : undefined;

  await controller.select("a");

  assert.deepEqual(
    controller.getSnapshot().events.map((item) => item.id),
    events.slice(-200).map((item) => item.id),
  );

  assert.equal(controller.getSnapshot().droppedEvents?.count, 805);

  assert.deepEqual(
    transport.calls
      .filter((call) => call.name === "get_user_agent_activity")
      .map((call) => call.args.after),
    [0],
  );

  await controller.refresh();

  assert.equal(
    transport.calls
      .filter((call) => call.name === "get_user_agent_activity")
      .at(-1)?.args.after,
    1005,
  );

  assert.equal(controller.getSnapshot().events.length, 200);
});

test("View activity scrolls to a turn in the window and reads one outside it", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];
  await controller.start();

  const events: Event[] = [];

  const add = (type: string, data: Record<string, unknown> = {}) =>
    events.push(
      decodedEvent({
        id: events.length + 1,
        task_id: "a",
        type,
        timestamp: "",
        data,
      }),
    );

  for (const [turn, count] of [
    [1, 300],
    [2, 10],
  ]) {
    add("task.started", { turn });
    for (let i = 0; i < count; i++) add("log");

    add("task.turn_ended", {
      turn,
      outcome: "completed",
      runtime_ms: 0,
      cost_usd: 0,
    });

    add("task.completed");
  }

  transport.handler = (name, args) => {
    if (name === "get_user_agent_activity") {
      return windowActivity(events, Number(args.after));
    }

    if (name === "get_user_agent_turn_activity") {
      return windowTurnActivity(events, Number(args.turn));
    }

    return undefined;
  };

  await controller.select("a");
  await controller.viewTurnActivity(2);

  assert.equal(controller.getSnapshot().tab, "activity");

  assert.deepEqual(controller.getSnapshot().activityFocus, {
    task: "a",
    turn: 2,
    request: 1,
  });

  assert.ok(
    !transport.calls.some(
      (call) => call.name === "get_user_agent_turn_activity",
    ),
    "A turn in the window needs no read",
  );

  await controller.viewTurnActivity(1);
  const page = windowTurnActivity(events, 1);

  assert.deepEqual(
    transport.calls.find((call) => call.name === "get_user_agent_turn_activity")
      ?.args,
    { task_id: "a", turn: 1 },
  );

  assert.deepEqual(controller.getSnapshot().activityFocus, {
    task: "a",
    turn: 1,
    request: 2,
    range: { events: page.events, dropped: page.dropped },
  });

  assert.equal(page.events.at(0)?.type, "log");
  assert.equal(page.dropped?.count, 103);

  controller.showLatestActivity();
  assert.equal(controller.getSnapshot().activityFocus, undefined);
  assert.equal(controller.getSnapshot().events.length, 200);
});

test("the panel follows a running task's draft by chained reads, then reads the stored message", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];
  const drafts = ["Hel", "Hello", "Hello there"];

  transport.handler = (name, args) => {
    if (name !== "get_user_agent_draft") return undefined;
    const text = drafts.shift();

    // After the last piece the message is stored and the turn has ended.
    return Promise.resolve(
      text
        ? { draft: { message_id: "m", text }, running: true }
        : { draft: null, running: false },
    ).then((read) => {
      assert.equal(args.wait_ms, 20000);

      return read;
    });
  };

  // A wide panel selects the running task on start.
  await controller.start();
  assert.equal(controller.getSnapshot().selected, "a");

  await vi.waitFor(() =>
    assert.ok(
      transport.calls.filter((call) => call.name === "get_user_agent_draft")
        .length >= 4,
    ),
  );

  const reads = transport.calls
    .filter((call) => call.name === "get_user_agent_draft")
    .map((call) => [call.args.message_id, call.args.after_length])
    .slice(0, 4);

  // Each read asks only for what follows the draft it has.
  assert.deepEqual(reads, [
    [undefined, undefined],
    ["m", 3],
    ["m", 5],
    ["m", 11],
  ]);

  await vi.waitFor(() =>
    assert.equal(controller.getSnapshot().draft, undefined),
  );
});

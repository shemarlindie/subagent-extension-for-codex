import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { decodedEvent } from "../../../shared/events/decode";
import { windowActivity } from "../../../shared/tasks/activity/activity-tail";
import { deferred, flush, setup, task } from "./controller-test-harness";

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
    if (name === "list_tasks") return tasksRead.promise;
    if (name === "app_get_activity") return activityRead.promise;
    if (name === "app_get_chat") return chatRead.promise;

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

test("returning to a task rejects chat and activity from its previous selection", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a"), task("b")];
  await controller.start();
  const activityRead = deferred<unknown>();
  const chatRead = deferred<unknown>();
  let firstSelection = true;

  transport.handler = (name, args) => {
    if (firstSelection && args.task_id === "a") {
      if (name === "app_get_activity") return activityRead.promise;
      if (name === "app_get_chat") return chatRead.promise;
    }

    if (name === "app_get_activity") {
      return {
        events: [
          {
            id: 2,
            task_id: args.task_id,
            type: "log",
            timestamp: "",
            data: {},
          },
        ],
      };
    }

    if (name === "app_get_chat") return { items: [], next_cursor: 2 };

    return undefined;
  };

  const first = controller.select("a");
  firstSelection = false;
  await controller.select("b");
  await controller.select("a");

  activityRead.resolve({
    events: [{ id: 1, task_id: "a", type: "log", timestamp: "", data: {} }],
  });

  chatRead.resolve({ items: [], next_cursor: 1 });

  await first;
  assert.equal(controller.getSnapshot().selected, "a");
  assert.equal(controller.getSnapshot().chat?.cursor, 2);

  assert.deepEqual(
    controller.getSnapshot().events.map((item) => item.id),
    [2],
  );
});

for (const transition of [
  "a newer turn",
  "reselecting the same task",
  "returning from latest activity",
] as const) {
  test(`late turn activity cannot replace ${transition}`, async (t) => {
    const { controller, transport } = setup();
    t.onTestFinished(() => controller.dispose());
    transport.tasks = [task("a"), task("b")];
    await controller.start();
    await controller.select("a");

    const oldRead = deferred<unknown>();
    const newRead = deferred<unknown>();
    let reads = 0;

    transport.handler = (name) => {
      if (name === "app_get_turn_activity") {
        return reads++ === 0 ? oldRead.promise : newRead.promise;
      }

      return undefined;
    };

    const oldTurn = controller.viewTurnActivity(1);

    if (transition === "reselecting the same task") {
      await controller.select("b");
      await controller.select("a");
    } else if (transition === "returning from latest activity") {
      controller.showLatestActivity();
    }

    const newTurn = controller.viewTurnActivity(2);

    const events = [
      { id: 2, task_id: "a", type: "log", timestamp: "", data: {} },
    ];

    newRead.resolve({ turn: 2, events });
    await newTurn;

    oldRead.resolve({ turn: 1, events: [] });
    await oldTurn;

    const focus = controller.getSnapshot().activityFocus;
    assert.equal(focus?.turn, 2);
    assert.ok(focus?.range && focus.range !== "loading");

    assert.deepEqual(
      focus.range.events.map((event) => event.id),
      [2],
    );
  });
}

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
    name === "app_get_activity"
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
      .filter((call) => call.name === "app_get_activity")
      .map((call) => call.args.after),
    [0],
  );

  await controller.refresh();

  assert.equal(
    transport.calls.filter((call) => call.name === "app_get_activity").at(-1)
      ?.args.after,
    1005,
  );

  assert.equal(controller.getSnapshot().events.length, 200);
});

test("the panel follows a running task's draft through update waits, then reads the stored message", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];
  const drafts = ["Hel", "Hello", "Hello there"];
  let waits = 0;
  const answered = drafts.length + 1;

  transport.handler = (name, args) => {
    if (name !== "app_wait_for_updates") return undefined;

    // Selecting the task reads its draft at once; it has none yet.
    if (args.wait_ms === 0) {
      return { revision: "r0", draft: null, running: true };
    }

    // Later waits hold, as if nothing changes.
    if (waits++ >= answered) return new Promise(() => {});
    const text = drafts.shift();

    // After the last piece the message is stored and the turn has ended.
    return text
      ? { revision: "r1", draft: { message_id: "m", text }, running: true }
      : { revision: "r2", draft: null, running: false };
  };

  // A wide panel selects the running task on start.
  await controller.start();
  assert.equal(controller.getSnapshot().selected, "a");

  const calls = () =>
    transport.calls.filter(
      (call) => call.name === "app_wait_for_updates" && call.args.wait_ms,
    );

  await vi.waitFor(() => assert.ok(calls().length >= 5));

  // The wait protocol itself is covered by update-follower.test.ts.
  assert.deepEqual(calls()[0]?.args.draft, { task_id: "a" });

  await vi.waitFor(() =>
    assert.equal(controller.getSnapshot().draft, undefined),
  );
});

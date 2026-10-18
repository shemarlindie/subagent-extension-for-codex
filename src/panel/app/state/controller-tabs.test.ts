import assert from "node:assert/strict";

import { test } from "vitest";

import type { Changes } from "../../features/changes/types";
import { deferred, flush, setup, task } from "./controller-test-harness";

test("each task remembers its tab across switching tasks and closing the inspector", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a"), task("b"), task("new")];
  await controller.start();

  await controller.select("a");
  controller.setTab("activity");
  await controller.select("b");
  assert.equal(controller.getSnapshot().tab, "chat");

  await controller.select("a");
  assert.equal(controller.getSnapshot().tab, "activity");
  controller.back();
  await controller.select("a");
  assert.equal(controller.getSnapshot().tab, "activity");

  await controller.select("new");
  assert.equal(controller.getSnapshot().tab, "chat");
  await controller.select("b");
  assert.equal(controller.getSnapshot().tab, "chat");
});

test("host selections restore a task's remembered tab unless they explicitly request another", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a"), task("b")];
  await controller.start();
  await controller.select("a");
  controller.setTab("activity");
  await controller.select("b");

  controller.applyScope(
    {
      panel_scope: { conversation_id: null },
      panel_selection: { task_id: "a" },
    },
    false,
  );

  assert.equal(controller.getSnapshot().tab, "activity");

  controller.applyScope(
    {
      panel_scope: { conversation_id: null },
      panel_selection: { task_id: "a", tab: "chat" },
    },
    false,
  );

  assert.equal(controller.getSnapshot().tab, "chat");
  await controller.select("b");
  await controller.select("a");
  assert.equal(controller.getSnapshot().tab, "chat");
});

// The Changes tab reads every change; Details reads only the totals.
for (const tab of ["changes", "details"] as const) {
  test(`returning to a remembered ${tab} tab reads that task's changes`, async (t) => {
    const { controller, transport } = setup();
    t.onTestFinished(() => controller.dispose());
    transport.tasks = [task("a"), task("b")];

    transport.handler = (name, args) => {
      if (name === "get_agent_changes") {
        return {
          scope: "task",
          files: [],
          additions: args.task_id === "a" ? 1 : 2,
          deletions: 0,
          diff: "",
        };
      }

      if (name === "get_user_agent_change_counts") {
        return {
          scope: "task",
          files: 0,
          additions: args.task_id === "a" ? 1 : 2,
          deletions: 0,
        };
      }

      return undefined;
    };

    await controller.start();
    await controller.select("a");
    controller.setTab(tab);
    await flush();
    await controller.select("b");
    controller.setTab(tab);
    await flush();
    transport.calls = [];

    await controller.select("a");
    await flush();

    assert.equal(controller.getSnapshot().tab, tab);
    assert.equal(controller.getSnapshot().changeCounts?.task, "a");
    assert.equal(controller.getSnapshot().changeCounts?.data?.additions, 1);

    assert.equal(
      controller.getSnapshot().changes?.task,
      tab === "changes" ? "a" : undefined,
    );

    const readsOf = (name: string) =>
      transport.calls
        .filter((call) => call.name === name)
        .map((call) => call.args.task_id);

    assert.deepEqual(readsOf("get_user_agent_change_counts"), ["a"]);

    assert.deepEqual(
      readsOf("get_agent_changes"),
      tab === "changes" ? ["a"] : [],
    );
  });
}

test("a host link opens the Changes tab, and a read for a replaced task is dropped", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a"), task("b")];
  const gate = deferred<unknown>();

  const changes = (id: string) => ({
    scope: "task",
    files: [],
    additions: id === "a" ? 1 : 2,
    deletions: 0,
    diff: "",
  });

  transport.handler = (name, args) => {
    if (name === "get_agent_changes" && args.task_id === "a") {
      return gate.promise;
    }

    if (name === "get_agent_changes") return changes("b");

    return undefined;
  };

  await controller.start();

  controller.applyScope(
    {
      panel_scope: { conversation_id: null },
      panel_selection: { task_id: "a", tab: "changes" },
    },
    false,
  );

  assert.equal(controller.getSnapshot().tab, "changes");
  const first = controller.loadChanges();
  await controller.select("b");
  controller.setTab("changes");
  await flush();
  gate.resolve(changes("a"));
  await first;

  assert.equal(controller.getSnapshot().changes?.task, "b");
  assert.equal(controller.getSnapshot().changes?.data?.additions, 2);
});

test("same-scope refresh retains the last changes while reading and after failure; scope switches clear them", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];

  const data: Changes = {
    scope: "task",
    files: [],
    additions: 3,
    deletions: 0,
    diff: "",
  };

  transport.handler = (name) =>
    name === "get_agent_changes" ? data : undefined;

  await controller.start();
  await controller.select("a");
  await controller.loadChanges();
  const lastLoaded = controller.getSnapshot().changes?.data;
  const refreshGate = deferred<Changes>();

  transport.handler = (name) =>
    name === "get_agent_changes" ? refreshGate.promise : undefined;

  const refresh = controller.loadChanges();

  assert.equal(controller.getSnapshot().changes?.loading, true);
  assert.equal(controller.getSnapshot().changes?.data, lastLoaded);
  refreshGate.reject(new Error("Git read failed"));
  await refresh;
  assert.equal(controller.getSnapshot().changes?.loading, false);
  assert.equal(controller.getSnapshot().changes?.data, lastLoaded);
  assert.equal(controller.getSnapshot().changes?.error, "Git read failed");

  const scopeGate = deferred<Changes>();

  transport.handler = (name) =>
    name === "get_agent_changes" ? scopeGate.promise : undefined;

  const switching = controller.loadChanges("turn");

  assert.equal(controller.getSnapshot().changes?.scope, "turn");
  assert.equal(controller.getSnapshot().changes?.loading, true);
  assert.equal(controller.getSnapshot().changes?.data, undefined);
  assert.equal(controller.getSnapshot().changes?.error, undefined);
  scopeGate.reject(new Error("Turn read failed"));
  await switching;
  assert.equal(controller.getSnapshot().changes?.loading, false);
  assert.equal(controller.getSnapshot().changes?.data, undefined);
  assert.equal(controller.getSnapshot().changes?.error, "Turn read failed");
});

test("a delayed changes refresh cannot replace a newer scope read", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];
  await controller.start();
  await controller.select("a");
  const gate = deferred<Changes>();

  const turn: Changes = {
    scope: "turn",
    files: [],
    additions: 2,
    deletions: 0,
    diff: "",
  };

  transport.handler = (name, args) => {
    if (name === "get_agent_changes" && args.scope === "task") {
      return gate.promise;
    }

    if (name === "get_agent_changes") return turn;

    return undefined;
  };

  const oldRead = controller.loadChanges("task");
  await controller.loadChanges("turn");
  gate.resolve({ ...turn, scope: "task", additions: 99 });
  await oldRead;

  assert.equal(controller.getSnapshot().changes?.scope, "turn");
  assert.equal(controller.getSnapshot().changes?.data?.additions, 2);
});

test("selecting a task loads its change counts without reading its changes", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];

  transport.handler = (name) =>
    name === "get_user_agent_change_counts"
      ? { scope: "task", files: 4, additions: 9, deletions: 2 }
      : undefined;

  await controller.start();
  await controller.select("a");
  await flush();

  assert.equal(controller.getSnapshot().changeCounts?.data?.files, 4);
  assert.equal(controller.getSnapshot().changes, undefined);

  const names = transport.calls.map((call) => call.name);

  assert.ok(names.includes("get_user_agent_change_counts"));
  assert.ok(!names.includes("get_agent_changes"));
});

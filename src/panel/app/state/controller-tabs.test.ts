import assert from "node:assert/strict";

import { test } from "vitest";

import type { ChangeList } from "../../features/changes/types";
import { deferred, flush, setup, task } from "./controller-test-harness";

test("each task remembers its tab across switching tasks and closing the inspector", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a"), task("b"), task("new")];
  await controller.start();

  await controller.selection.select("a");
  controller.selection.setTab("activity");
  await controller.selection.select("b");
  assert.equal(controller.getSnapshot().tab, "chat");

  await controller.selection.select("a");
  assert.equal(controller.getSnapshot().tab, "activity");
  controller.selection.back();
  await controller.selection.select("a");
  assert.equal(controller.getSnapshot().tab, "activity");

  await controller.selection.select("new");
  assert.equal(controller.getSnapshot().tab, "chat");
  await controller.selection.select("b");
  assert.equal(controller.getSnapshot().tab, "chat");
});

test("host selections restore a task's remembered tab unless they explicitly request another", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a"), task("b")];
  await controller.start();
  await controller.selection.select("a");
  controller.selection.setTab("activity");
  await controller.selection.select("b");

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
  await controller.selection.select("b");
  await controller.selection.select("a");
  assert.equal(controller.getSnapshot().tab, "chat");
});

// The Changes tab reads the change list. Details reads only the totals.
for (const tab of ["changes", "details"] as const) {
  test(`returning to a remembered ${tab} tab reads that task's changes`, async (t) => {
    const { controller, transport } = setup();
    t.onTestFinished(() => controller.dispose());
    transport.tasks = [task("a"), task("b")];

    transport.handler = (name, args) => {
      if (name === "app_get_change_list") {
        return {
          scope: "task",
          files: [],
          additions: args.task_id === "a" ? 1 : 2,
          deletions: 0,
          revision: "r1",
        };
      }

      if (name === "app_get_change_counts") {
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
    await controller.selection.select("a");
    controller.selection.setTab(tab);
    await flush();
    await controller.selection.select("b");
    controller.selection.setTab(tab);
    await flush();
    transport.calls = [];

    await controller.selection.select("a");
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

    assert.deepEqual(readsOf("app_get_change_counts"), ["a"]);

    assert.deepEqual(
      readsOf("app_get_change_list"),
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
    revision: "r1",
  });

  transport.handler = (name, args) => {
    if (name === "app_get_change_list" && args.task_id === "a") {
      return gate.promise;
    }

    if (name === "app_get_change_list") return changes("b");

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
  const first = controller.changes.loadChanges();
  await controller.selection.select("b");
  controller.selection.setTab("changes");
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

  const data: ChangeList = {
    scope: "task",
    files: [],
    additions: 3,
    deletions: 0,
    revision: "r1",
  };

  transport.handler = (name) =>
    name === "app_get_change_list" ? data : undefined;

  await controller.start();
  await controller.selection.select("a");
  await controller.changes.loadChanges();
  const lastLoaded = controller.getSnapshot().changes?.data;
  const refreshGate = deferred<ChangeList>();

  transport.handler = (name) =>
    name === "app_get_change_list" ? refreshGate.promise : undefined;

  const refresh = controller.changes.loadChanges();

  assert.equal(controller.getSnapshot().changes?.loading, true);
  assert.equal(controller.getSnapshot().changes?.data, lastLoaded);
  refreshGate.reject(new Error("Git read failed"));
  await refresh;
  assert.equal(controller.getSnapshot().changes?.loading, false);
  assert.equal(controller.getSnapshot().changes?.data, lastLoaded);
  assert.equal(controller.getSnapshot().changes?.error, "Git read failed");

  const scopeGate = deferred<ChangeList>();

  transport.handler = (name) =>
    name === "app_get_change_list" ? scopeGate.promise : undefined;

  const switching = controller.changes.loadChanges("turn");

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
  await controller.selection.select("a");
  const gate = deferred<ChangeList>();

  const turn: ChangeList = {
    scope: "turn",
    files: [],
    additions: 2,
    deletions: 0,
    revision: "r1",
  };

  transport.handler = (name, args) => {
    if (name === "app_get_change_list" && args.scope === "task") {
      return gate.promise;
    }

    if (name === "app_get_change_list") return turn;

    return undefined;
  };

  const oldRead = controller.changes.loadChanges("task");
  await controller.changes.loadChanges("turn");
  gate.resolve({ ...turn, scope: "task", additions: 99 });
  await oldRead;

  assert.equal(controller.getSnapshot().changes?.scope, "turn");
  assert.equal(controller.getSnapshot().changes?.data?.additions, 2);
});

test("diffs read one at a time in the order asked, and a stale read reloads the list and drops the old diffs", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];

  const file = (path: string, signature: string) => ({
    path,
    status: "modified" as const,
    additions: 1,
    deletions: 0,
    source: "tool" as const,
    incomplete: false,
    signature,
  });

  const list = (revision: string): ChangeList => ({
    scope: "task",
    files: [file("a.ts", revision), file("b.ts", revision)],
    additions: 2,
    deletions: 0,
    revision,
  });

  let revision = "r1";
  const reads: string[] = [];
  const gate = deferred<unknown>();

  transport.handler = (name, args) => {
    if (name === "app_get_change_list") return list(revision);
    if (name !== "app_get_file_change") return undefined;
    reads.push(`${String(args.path)}@${String(args.revision)}`);
    if (args.revision !== revision) return { stale: true };
    const diff = `diff --git a/${String(args.path)} b/${String(args.path)}\n--- a/${String(args.path)}\n+++ b/${String(args.path)}\n@@ -1 +1 @@\n-${revision}\n+${revision} new\n`;

    return args.path === "a.ts" && revision === "r1"
      ? gate.promise.then(() => ({ stale: false, diff }))
      : { stale: false, diff };
  };

  await controller.start();
  await controller.selection.select("a");
  await controller.changes.loadChanges();
  const first = controller.changes.loadDiff("a.ts");
  const second = controller.changes.loadDiff("b.ts");
  await flush();
  // b.ts waits for a.ts.
  assert.deepEqual(reads, ["a.ts@r1"]);
  // A turn records new edits while a.ts is read, so b.ts reads as stale.
  revision = "r2";
  gate.resolve(undefined);
  await first;
  const diffs = () => controller.getSnapshot().changeDiffs;
  await second;
  assert.deepEqual(reads, ["a.ts@r1", "b.ts@r1"]);
  assert.equal(controller.getSnapshot().changes?.data?.revision, "r2");
  assert.equal(diffs()?.revision, "r2");
  assert.deepEqual(diffs()?.files, {});

  await controller.changes.loadDiff("b.ts");
  const read = diffs()?.files["b.ts"];
  assert.equal(read?.status === "ready" && read.diff?.additions, 1);
  assert.deepEqual(reads.at(-1), "b.ts@r2");
});

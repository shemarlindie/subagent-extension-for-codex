import assert from "node:assert/strict";

import { test } from "vitest";

import { deferred, flush, setup, task } from "./controller-test-harness";

const later = (id: string) => ({
  ...task(id),
  created_at: "2026-10-21T01:00:00.000Z",
});

test("the panel opens a task that starts elsewhere, but not ones it already listed", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("old")];
  await controller.start();
  assert.equal(controller.getSnapshot().selected, "old");

  await controller.select("old");
  transport.tasks = [later("new"), task("old")];
  await controller.refresh();
  assert.equal(controller.getSnapshot().selected, "new");

  // A later read with nothing new keeps the user's choice.
  await controller.select("old");
  await controller.refresh();
  assert.equal(controller.getSnapshot().selected, "old");
});

test("the panel stays put while composing a task or after going back to the list", async (t) => {
  for (const leave of ["compose", "back"] as const) {
    const { controller, transport } = setup(true);
    t.onTestFinished(() => controller.dispose());
    transport.tasks = [task("old")];
    await controller.start();

    if (leave === "compose") controller.newTasks.open();
    else controller.back();

    transport.tasks = [later("new"), task("old")];
    await controller.refresh();

    // Composing shows the composer in place of a task, so neither selects one.
    assert.equal(controller.getSnapshot().selected, undefined, leave);

    assert.equal(
      Boolean(controller.getSnapshot().newTask),
      leave === "compose",
    );
  }
});

test("a delayed task arrival preserves a selection made after the refresh started", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("old"), task("other")];
  await controller.start();

  const pendingTasks = deferred<ReturnType<typeof task>[]>();

  transport.handler = (name) =>
    name === "list_tasks" ? pendingTasks.promise : undefined;

  const refresh = controller.refresh();
  await flush();

  assert.equal(
    transport.calls.filter((call) => call.name === "list_tasks").length,
    2,
  );

  await controller.select("other");
  transport.tasks = [later("new"), task("old"), task("other")];
  pendingTasks.resolve(transport.tasks);
  await refresh;
  assert.equal(controller.getSnapshot().selected, "other");

  transport.handler = undefined;
  await controller.refresh();
  assert.equal(controller.getSnapshot().selected, "other");
});

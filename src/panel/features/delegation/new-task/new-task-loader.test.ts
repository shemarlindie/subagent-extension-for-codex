import assert from "node:assert/strict";

import { test } from "vitest";

import {
  deferred,
  flush,
  setup,
  task,
} from "../../../app/state/controller-test-harness";
import type { DelegateValues } from "../delegate-values";
import { newTaskSessionId } from "./new-task-values";

const values: DelegateValues = {
  permission_mode: "acceptEdits",
  approval_decider: "user",
  sandbox: "off",
  repository: "/repo/a",
  description: "Fix the flaky login test",
  worker: "claude:implementer",
  model: "",
  reasoning_effort: "default",
  revision: "HEAD",
  workspace_strategy: "current_repo",
  runtimeMode: "none",
  runtime: "",
  costMode: "none",
  cost: "",
};

async function started(wide = true) {
  const harness = setup(wide);
  harness.transport.tasks = [task("a")];
  await harness.controller.start();
  await flush();

  return harness;
}

test("a failed start keeps the composer and its draft and returns the error", async (t) => {
  const { controller, transport } = await started();
  t.onTestFinished(() => controller.dispose());

  transport.handler = (name) =>
    name === "start_task"
      ? Promise.reject(new Error("Repository is not approved"))
      : undefined;

  controller.newTasks.open();
  await flush();

  controller.session.update("newTask", newTaskSessionId(), {
    draft: { description: values.description },
  });

  assert.equal(
    await controller.newTasks.start(values),
    "Repository is not approved",
  );

  assert.ok(controller.getSnapshot().newTask);
  assert.equal(controller.getSnapshot().busy, false);

  assert.equal(
    controller.session.get("newTask", newTaskSessionId()).draft.description,
    values.description,
  );
});

test("a thread's composer starts the task in that conversation and clears only its draft", async (t) => {
  const { controller, transport } = await started();
  t.onTestFinished(() => controller.dispose());
  transport.handler = (name) => (name === "start_task" ? task("b") : undefined);

  controller.applyScope(
    { panel_scope: { conversation_id: "chat-1", repository: "/repo/a" } },
    false,
  );

  controller.newTasks.open();
  await flush();

  const draft = { description: values.description };
  controller.session.update("newTask", newTaskSessionId(), { draft });
  controller.session.update("newTask", newTaskSessionId("chat-1"), { draft });

  assert.equal(await controller.newTasks.start(values), undefined);

  const start = transport.calls.find((call) => call.name === "start_task");
  assert.equal(start?.args.conversation_id, "chat-1");

  const saved = (conversation?: string) =>
    controller.session.get("newTask", newTaskSessionId(conversation)).draft
      .description;

  assert.equal(saved("chat-1"), undefined);
  assert.equal(saved(), values.description);
});

test("a task that starts after the scope changes is not selected", async (t) => {
  const { controller, transport } = await started();
  t.onTestFinished(() => controller.dispose());
  const gate = deferred<ReturnType<typeof task>>();

  transport.handler = (name) =>
    name === "start_task" ? gate.promise : undefined;

  controller.newTasks.open();
  await flush();

  const starting = controller.newTasks.start(values);
  await flush();

  controller.applyScope(
    { panel_scope: { conversation_id: null, repository: "/repo/a" } },
    false,
  );

  gate.resolve(task("late"));

  assert.match((await starting) ?? "", /changed while the task was starting/);
  assert.notEqual(controller.getSnapshot().selected, "late");
});

test("the composer follows project changes and closes for another conversation", async (t) => {
  const { controller } = await started();
  t.onTestFinished(() => controller.dispose());

  const follows = (scope: Record<string, unknown>) => {
    controller.applyScope({ panel_scope: scope }, false);
    const { newTask, scopeVersion } = controller.getSnapshot();
    assert.equal(newTask?.scope, scopeVersion);
  };

  controller.newTasks.open();
  await flush();
  follows({ conversation_id: null, repository: "/repo/a" });

  controller.applyScope({ panel_scope: { conversation_id: "chat-1" } }, false);
  assert.equal(controller.getSnapshot().newTask, undefined);

  controller.newTasks.open();
  await flush();
  follows({ conversation_id: "chat-1", repository: "/repo/a" });
});

test("a profile choice saves as its default and rolls back when saving fails", async (t) => {
  const { controller, transport } = await started();
  t.onTestFinished(() => controller.dispose());
  controller.newTasks.open();
  await flush();

  const saved = () =>
    controller.getSnapshot().newTask?.defaults?.models.profiles.implementer
      .model;

  transport.handler = (name) => (name === "update_settings" ? {} : undefined);

  assert.equal(
    await controller.newTasks.saveProfileSetting(
      "claude:implementer",
      "model",
      "opus",
    ),
    undefined,
  );

  assert.deepEqual(transport.calls.at(-1), {
    name: "update_settings",
    args: { set: { models: { profiles: { implementer: { model: "opus" } } } } },
  });

  assert.equal(saved(), "opus");

  transport.handler = (name) =>
    name === "update_settings"
      ? Promise.reject(new Error("Service unavailable"))
      : undefined;

  assert.equal(
    await controller.newTasks.saveProfileSetting(
      "claude:implementer",
      "model",
      "haiku",
    ),
    "The Implementer profile's default could not be saved: Service unavailable",
  );

  assert.equal(saved(), "opus");
});

test("saved defaults keep each confirmed profile choice until a read includes it", async (t) => {
  const { controller, transport } = await started();
  t.onTestFinished(() => controller.dispose());

  controller.newTasks.open();
  await flush();
  const loaded = controller.getSnapshot().newTask?.defaults;
  assert.ok(loaded);

  // Closing before any save starts keeps the loaded defaults.
  controller.selection.back();
  assert.equal(controller.getSnapshot().newTask, undefined);
  assert.deepEqual(controller.newTasks.savedDefaults(), loaded);

  const model = () =>
    controller.newTasks.savedDefaults()?.models.profiles.implementer.model;

  const save = (value: string) =>
    controller.newTasks.saveProfileSetting(
      "claude:implementer",
      "model",
      value,
    );

  // A failed save keeps them too.
  transport.handler = (name) =>
    name === "update_settings"
      ? Promise.reject(new Error("Service unavailable"))
      : undefined;

  await save("haiku");
  assert.deepEqual(controller.newTasks.savedDefaults(), loaded);

  // A read that overlaps a save, starting during it or before, can miss it,
  // so the save stays.
  for (const [value, saveFirst] of [
    ["opus", true],
    ["sonnet", false],
  ] as const) {
    const saving = deferred<unknown>();
    const reading = deferred<unknown>();

    transport.handler = (name) => {
      if (name === "update_settings") return saving.promise;

      return name === "get_settings" ? reading.promise : undefined;
    };

    if (!saveFirst) controller.newTasks.open();
    const saved = save(value);
    if (saveFirst) controller.newTasks.open();
    saving.resolve({});
    await saved;
    reading.resolve({ values: loaded });
    await flush();
    assert.equal(model(), value);
    controller.selection.back();
  }

  // A read that starts with no save running includes every save.
  transport.handler = undefined;
  controller.newTasks.open();
  await flush();
  assert.equal(model(), loaded.models.profiles.implementer.model);
});

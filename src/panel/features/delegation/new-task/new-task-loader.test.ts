import assert from "node:assert/strict";

import { test } from "vitest";

import {
  deferred,
  flush,
  setup,
  task,
} from "../../../app/state/controller-test-harness";
import type { DelegateValues } from "../delegate-values";
import { NEW_TASK_SESSION_ID } from "./new-task-values";

const values: DelegateValues = {
  permission_mode: "acceptEdits",
  approval_decider: "user",
  sandbox: "off",
  repository: "/repo/a",
  description: "Fix the flaky login test",
  worker: "claude:general",
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

  controller.session.update("newTask", NEW_TASK_SESSION_ID, {
    draft: { description: values.description },
  });

  assert.equal(
    await controller.newTasks.start(values),
    "Repository is not approved",
  );

  assert.ok(controller.getSnapshot().newTask);
  assert.equal(controller.getSnapshot().busy, false);

  assert.equal(
    controller.session.get("newTask", NEW_TASK_SESSION_ID).draft.description,
    values.description,
  );
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

test("the composer follows global project changes and closes for a chat scope", async (t) => {
  const { controller } = await started();
  t.onTestFinished(() => controller.dispose());
  controller.newTasks.open();
  await flush();

  controller.applyScope(
    { panel_scope: { conversation_id: null, repository: "/repo/a" } },
    false,
  );

  const { newTask, scopeVersion } = controller.getSnapshot();
  assert.equal(newTask?.scope, scopeVersion);

  controller.applyScope({ panel_scope: { conversation_id: "chat-1" } }, false);
  assert.equal(controller.getSnapshot().newTask, undefined);
});

test("a profile choice saves as its default and rolls back when saving fails", async (t) => {
  const { controller, transport } = await started();
  t.onTestFinished(() => controller.dispose());
  controller.newTasks.open();
  await flush();

  const saved = () =>
    controller.getSnapshot().newTask?.defaults?.models.profiles.general.model;

  transport.handler = (name) => (name === "update_settings" ? {} : undefined);

  assert.equal(
    await controller.newTasks.saveProfileSetting(
      "claude:general",
      "model",
      "opus",
    ),
    undefined,
  );

  assert.deepEqual(transport.calls.at(-1), {
    name: "update_settings",
    args: { set: { models: { profiles: { general: { model: "opus" } } } } },
  });

  assert.equal(saved(), "opus");

  transport.handler = (name) =>
    name === "update_settings"
      ? Promise.reject(new Error("Service unavailable"))
      : undefined;

  assert.equal(
    await controller.newTasks.saveProfileSetting(
      "claude:general",
      "model",
      "haiku",
    ),
    "The General profile's default could not be saved: Service unavailable",
  );

  assert.equal(saved(), "opus");
});

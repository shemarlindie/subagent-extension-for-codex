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
  repository: "/repo/a",
  description: "Fix the flaky login test",
  worker: "claude:general",
  model: "",
  reasoning_effort: "default",
  revision: "HEAD",
  workspace_strategy: "current_repo",
  context: "",
  runtimeMode: "none",
  runtime: "",
  costMode: "none",
  cost: "",
  deps: [],
};

async function started(wide = true) {
  const harness = setup(wide);
  harness.transport.tasks = [task("a")];
  await harness.controller.start();
  await flush();

  return harness;
}

test("New task replaces the selected task with the composer and reads its options", async (t) => {
  const { controller } = await started();
  t.onTestFinished(() => controller.dispose());
  assert.equal(controller.getSnapshot().selected, "a");

  controller.newTasks.open();

  const opened = controller.getSnapshot();
  assert.equal(opened.selected, undefined);
  assert.equal(opened.newTask?.statuses.settings, "loading");

  await flush();
  const newTask = controller.getSnapshot().newTask;
  assert.ok(newTask);
  assert.ok(Object.values(newTask.statuses).every((s) => s === "ready"));
  assert.equal(newTask.defaults?.default_provider, "claude");

  // A wide panel would otherwise reselect its default task on refresh.
  await controller.refresh();
  assert.equal(controller.getSnapshot().selected, undefined);
  assert.ok(controller.getSnapshot().newTask);
});

test("starting a composed task sends its options, selects it and clears the draft", async (t) => {
  const { controller, transport } = await started();
  t.onTestFinished(() => controller.dispose());
  const created = { ...task("new"), worker_profile: "general" as const };

  transport.handler = (name) => {
    if (name === "start_agent_task") return created;
    if (name === "list_agent_tasks") return [created, task("a")];

    return undefined;
  };

  controller.newTasks.open();
  await flush();

  controller.session.update("newTask", NEW_TASK_SESSION_ID, {
    draft: { description: values.description },
  });

  assert.equal(await controller.newTasks.start(values), undefined);

  const call = transport.calls.find((item) => item.name === "start_agent_task");

  assert.deepEqual(call?.args, {
    provider_options: {
      claude: { permission_mode: "acceptEdits", approval_decider: "user" },
    },
    repository: "/repo/a",
    description: "Fix the flaky login test",
    provider: "claude",
    worker_profile: "general",
    model: "",
    reasoning_effort: "default",
    revision: "HEAD",
    workspace_strategy: "current_repo",
    conversation_id: null,
    context: [],
    depends_on: [],
    budget: { max_runtime_minutes: null, max_cost_usd: null },
  });

  const state = controller.getSnapshot();
  assert.equal(state.selected, "new");
  assert.equal(state.newTask, undefined);
  assert.equal(state.busy, false);

  assert.deepEqual(
    controller.session.get("newTask", NEW_TASK_SESSION_ID).draft,
    {},
  );
});

test("a failed start keeps the composer and its draft and returns the error", async (t) => {
  const { controller, transport } = await started();
  t.onTestFinished(() => controller.dispose());

  transport.handler = (name) =>
    name === "start_agent_task"
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
    name === "start_agent_task" ? gate.promise : undefined;

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

test("selecting a task or going back closes the composer", async (t) => {
  const { controller } = await started();
  t.onTestFinished(() => controller.dispose());

  controller.newTasks.open();
  await controller.select("a");
  assert.equal(controller.getSnapshot().newTask, undefined);

  controller.newTasks.open();
  controller.back();
  assert.equal(controller.getSnapshot().newTask, undefined);
  assert.equal(controller.getSnapshot().selected, undefined);
});

import assert from "node:assert/strict";

import { test } from "vitest";

import { Controller } from "./controller";
import {
  FakeTransport,
  setupWithViewState,
  task,
} from "./controller-test-harness";
import { effectiveFilter, visibleTasks } from "./selectors";

test("browser view state seeds the first render, restores a task, and persists list navigation", async (t) => {
  const transport = new FakeTransport();

  transport.projects = [
    { repository: "/repo/a", kind: "repository" },
    { repository: "/repo/b", kind: "repository" },
  ];

  const selectedTask = task("b", "/repo/b");
  selectedTask.title = "Migrate config";
  transport.tasks = [task("a", "/repo/a"), selectedTask];

  const { controller, saved } = setupWithViewState(
    {
      view: {
        repository: "/repo/b",
        selected: "b",
        filter: "active",
        search: "Migrate",
        tab: "details",
      },
    },
    transport,
  );

  t.onTestFinished(() => controller.dispose());

  assert.equal(controller.getSnapshot().filter, "active");
  assert.equal(controller.getSnapshot().search, "Migrate");
  assert.equal(controller.getSnapshot().tab, "details");

  await controller.start();

  assert.equal(controller.getSnapshot().repository, "/repo/b");
  assert.equal(controller.getSnapshot().selected, "b");
  assert.equal(controller.getSnapshot().filter, "active");
  assert.equal(controller.getSnapshot().search, "Migrate");
  assert.equal(controller.getSnapshot().tab, "details");

  assert.deepEqual(
    transport.calls.find((call) => call.name === "list_tasks")?.args,
    { conversation_id: null, repository: "/repo/b" },
  );

  controller.back();

  assert.deepEqual(saved.at(-1), {
    view: {
      repository: "/repo/b",
      filter: "active",
      search: "Migrate",
      browsing: true,
    },
  });

  controller.setSearch("Changed");
  assert.equal(saved.at(-1)?.view.search, "Changed");
});

test("settings section preference persists separately from dialog drafts", async (t) => {
  const transport = new FakeTransport();

  const { controller, saved } = setupWithViewState({ view: {} }, transport);

  t.onTestFinished(() => controller.dispose());
  await controller.start();

  controller.saveSettingsSection("models");

  assert.equal(saved.at(-1)?.lastSettingsSection, "models");
  assert.equal(saved.at(-1)?.dialogs, undefined);

  const restored = new Controller(
    new FakeTransport(),
    { hidden: () => false, wide: () => true },
    { initial: saved.at(-1)!, save: () => {} },
  );

  t.onTestFinished(() => restored.dispose());
  assert.equal(restored.getLastSettingsSection(), "models");
});

test("restores saved dialogs in order and removes each deliberate close", async (t) => {
  const transport = new FakeTransport();
  transport.tasks = [task("task-1")];

  const { controller, saved } = setupWithViewState(
    {
      view: { selected: "task-1" },
      dialogs: [
        {
          kind: "project",
          repository: "/repo/draft",
          draft: { repository: "/repo/draft" },
        },
        {
          kind: "handoff",
          taskId: "task-1",
          target: { kind: "file", path: "src/auth.ts" },
          draft: { message: "continue the migration" },
        },
      ],
    },
    transport,
  );

  t.onTestFinished(() => controller.dispose());

  await controller.start();
  const handoff = controller.getSnapshot().dialog;
  assert.equal(handoff?.kind, "handoff");
  if (handoff?.kind !== "handoff") throw new Error("Expected targeted handoff");
  assert.deepEqual(handoff.target, { kind: "file", path: "src/auth.ts" });

  assert.deepEqual(controller.getDialogDraft("handoff"), {
    message: "continue the migration",
  });

  controller.saveDialogDraft("handoff", { message: "updated draft" });

  assert.deepEqual(saved.at(-1)?.dialogs?.at(-1)?.draft, {
    message: "updated draft",
  });

  controller.dismiss();
  assert.equal(controller.getSnapshot().dialog?.kind, "project");

  assert.deepEqual(
    saved.at(-1)?.dialogs?.map(({ kind }) => kind),
    ["project"],
  );

  controller.dismiss();
  assert.equal(controller.getSnapshot().dialog, undefined);
  assert.equal(saved.at(-1)?.dialogs, undefined);
});

test("a restored filter with no matches falls back to precedence and is removed from the URL", async (t) => {
  const transport = new FakeTransport();
  const failed = task("failed");
  failed.title = "Migrate failed task";
  failed.status = "failed";
  const completed = task("completed");
  completed.title = "Migrate completed task";
  completed.status = "completed";
  transport.tasks = [completed, failed];

  const { controller, saved } = setupWithViewState(
    {
      view: { filter: "active", search: "Migrate", browsing: true },
    },
    transport,
  );

  t.onTestFinished(() => controller.dispose());

  assert.equal(controller.getSnapshot().filter, "active");

  controller.applyScope(
    {
      panel_scope: { conversation_id: null },
      panel_selection: { task_id: "host-selection", tab: "activity" },
    },
    false,
  );

  assert.equal(controller.getSnapshot().selected, undefined);
  assert.equal(controller.getSnapshot().filter, "active");
  assert.equal(controller.getSnapshot().search, "Migrate");

  await controller.start();

  assert.equal(controller.getSnapshot().filter, null);
  assert.equal(effectiveFilter(controller.getSnapshot()), "failed");

  assert.deepEqual(
    visibleTasks(controller.getSnapshot()).map((item) => item.id),
    ["failed"],
  );

  assert.equal(saved.at(-1)?.view.filter, undefined);
});

test("the file preview moves between changed files and saves where it is", async (t) => {
  const transport = new FakeTransport();
  transport.tasks = [task("task-1")];

  const { controller, saved } = setupWithViewState({ view: {} }, transport);

  t.onTestFinished(() => controller.dispose());
  await controller.start();

  // Only an open file preview moves.
  controller.showChangedFile("src/b.ts");
  assert.equal(controller.getSnapshot().dialog, undefined);

  controller.open({ kind: "file", task: task("task-1"), path: "src/a.ts" });
  controller.showChangedFile("src/b.ts");

  const dialog = controller.getSnapshot().dialog;

  assert.equal(dialog?.kind === "file" && dialog.path, "src/b.ts");

  assert.deepEqual(saved.at(-1)?.dialogs, [
    { kind: "file", taskId: "task-1", path: "src/b.ts" },
  ]);
});

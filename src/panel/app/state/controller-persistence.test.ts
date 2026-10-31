import assert from "node:assert/strict";

import { test } from "vitest";

import { Controller } from "./controller";
import {
  defaults,
  deferred,
  FakeTransport,
  flush,
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

test("closing a restored preview immediately skips unavailable and stale dialogs beneath it", async (t) => {
  const transport = new FakeTransport();
  const current = task("task-1");

  current.pending_input = {
    id: "current-request",
    tool: "Bash",
    kind: "permission",
    input: {},
  };

  transport.tasks = [current];

  const project = {
    kind: "project" as const,
    repository: "/repo/draft",
    draft: { repository: "/repo/draft" },
  };

  const { controller, saved } = setupWithViewState(
    {
      view: { selected: current.id, page: "projects" },
      dialogs: [
        project,
        { kind: "respond", taskId: current.id, requestId: "old-request" },
        { kind: "remove-project", repository: "/repo/missing" },
        { kind: "handoff", taskId: "missing-task" },
        { kind: "file", taskId: current.id, path: "src/auth.ts" },
      ],
    },
    transport,
  );

  t.onTestFinished(() => controller.dispose());
  await controller.start();
  assert.equal(controller.getSnapshot().dialog?.kind, "file");

  controller.dismiss();

  assert.equal(controller.getSnapshot().dialog?.kind, "project");
  assert.deepEqual(controller.getDialogDraft("project"), project.draft);
  assert.deepEqual(saved.at(-1)?.dialogs, [project]);
});

for (const kind of ["settings", "delegate"] as const) {
  test(`restored ${kind} drafts survive a failed read, editing and retry`, async (t) => {
    const transport = new FakeTransport();
    const firstRead = deferred<unknown>();
    const retryRead = deferred<unknown>();
    let reads = 0;

    transport.handler = (name) => {
      if (name === "get_settings") {
        return reads++ === 0 ? firstRead.promise : retryRead.promise;
      }

      return undefined;
    };

    const field =
      kind === "settings" ? "task-worktree_branch_prefix" : "description";

    const draft = {
      [field]: "Saved unsent draft",
      ...(kind === "settings"
        ? { "task-workspace_strategy": "worktree" }
        : { revision: "feature/draft" }),
    };

    const { controller, saved } = setupWithViewState(
      { view: {}, dialogs: [{ kind, draft }] },
      transport,
    );

    t.onTestFinished(() => controller.dispose());
    const starting = controller.start();
    await flush();

    assert.equal(controller.getSnapshot().dialog?.kind, `${kind}-loading`);
    assert.deepEqual(controller.getDialogDraft(kind), draft);
    firstRead.reject(new Error("Settings unavailable"));
    await starting;
    await flush();

    const failed = controller.getSnapshot().dialog;

    if (failed?.kind === "settings-loading") {
      assert.equal(failed.status, "error");
    } else {
      assert.ok(failed?.kind === "delegate-loading");
      assert.equal(failed.statuses.settings, "error");
    }

    controller.saveDialogField(kind, field, "Edited while unavailable");
    controller.retryDialogLoad();
    assert.equal(controller.getSnapshot().dialog?.kind, `${kind}-loading`);
    retryRead.resolve({ sections: [], values: defaults });
    await flush();

    assert.equal(controller.getSnapshot().dialog?.kind, kind);

    assert.deepEqual(controller.getDialogDraft(kind), {
      ...draft,
      [field]: "Edited while unavailable",
    });

    assert.deepEqual(saved.at(-1)?.dialogs?.at(-1)?.draft, {
      ...draft,
      [field]: "Edited while unavailable",
    });
  });
}

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

import assert from "node:assert/strict";

import { test } from "vitest";

import { deferred, flush, setup, task } from "./controller-test-harness";

test("project management discards a stale registry read and reconciles selected removal", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];
  await controller.start();
  await controller.changeProject("/repo/a");
  controller.manageProjects();
  const gate = deferred<typeof transport.projects>();
  let reads = 0;

  transport.handler = (name) => {
    if (name === "list_projects" && reads++ === 0) return gate.promise;

    if (name === "app_remove_project") {
      transport.projects = [];

      return { repository: "/repo/a" };
    }

    return undefined;
  };

  const refresh = controller.refresh();
  await flush();
  await controller.manageProject("/repo/a");
  gate.resolve([{ repository: "/repo/a", kind: "repository" }]);
  await refresh;
  await flush();
  assert.deepEqual(controller.getSnapshot().projects, []);
  assert.equal(controller.getSnapshot().repository, undefined);
  assert.equal(controller.getSnapshot().dialog, undefined);
  assert.equal(transport.tasks.length, 1);
});

test("a task-list read predating project removal never publishes its deleted tasks", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());

  transport.projects = [
    { repository: "/repo/a", kind: "repository" },
    { repository: "/repo/b", kind: "repository" },
  ];

  const survivor = task("survivor", "/repo/b");
  transport.tasks = [task("existing", "/repo/a"), survivor];
  await controller.start();
  await controller.select(survivor.id);
  controller.manageProjects();
  const tasksRead = deferred<unknown>();
  let reads = 0;

  transport.handler = (name) => {
    if (name === "list_tasks" && reads++ === 0) return tasksRead.promise;

    if (name === "app_remove_project") {
      transport.projects = [{ repository: "/repo/b", kind: "repository" }];
      transport.tasks = [survivor];

      return { repository: "/repo/a" };
    }

    return undefined;
  };

  const staleTasks: string[] = [];

  const unsubscribe = controller.subscribe(() => {
    if (controller.getSnapshot().tasks.some((item) => item.id === "deleted")) {
      staleTasks.push("deleted");
    }
  });

  t.onTestFinished(() => {
    unsubscribe();
  });

  const refresh = controller.refresh();
  await flush();
  assert.equal(reads, 1);

  assert.equal(
    await controller.manageProject("/repo/a", undefined, true),
    true,
  );

  tasksRead.resolve([task("deleted", "/repo/a"), survivor]);
  await refresh;
  await flush();

  assert.deepEqual(staleTasks, []);

  assert.deepEqual(
    controller.getSnapshot().tasks.map((item) => item.id),
    [survivor.id],
  );
});

test("other-panel removal clears selected project while renaming preserves scope", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  await controller.changeProject("/repo/a");
  controller.manageProjects();
  const version = controller.getSnapshot().scopeVersion;

  transport.handler = (name) => {
    if (name === "app_rename_project") return { name: "Renamed" };

    if (name === "list_projects") {
      return [{ repository: "/repo/a", name: "Renamed", kind: "repository" }];
    }

    return undefined;
  };

  await controller.manageProject("/repo/a", "Renamed");
  assert.equal(controller.getSnapshot().scopeVersion, version);
  const [renamed] = controller.getSnapshot().projects;
  assert.ok(renamed);
  assert.equal(renamed.name, "Renamed");
  assert.equal(controller.getSnapshot().repository, "/repo/a");

  transport.handler = (name) => (name === "list_projects" ? [] : undefined);

  await controller.refresh();
  assert.equal(controller.getSnapshot().repository, undefined);
  assert.equal(controller.getSnapshot().dialog, undefined);
});

test("a project mutation finishing in another scope cannot leave the panel busy or select old work", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  controller.manageProjects();
  const gate = deferred<{ repository: string }>();

  transport.handler = (name) =>
    name === "app_remove_project" ? gate.promise : undefined;

  const removing = controller.manageProject("/repo/a");
  await flush();

  controller.applyScope(
    {
      panel_scope: { conversation_id: "new-chat", repository: "/new-project" },
    },
    false,
  );

  gate.resolve({ repository: "/repo/a" });
  await removing;
  await flush();
  assert.equal(controller.getSnapshot().busy, false);
  assert.equal(controller.getSnapshot().dialog, undefined);
  assert.equal(controller.getSnapshot().conversation, "new-chat");
  assert.equal(controller.getSnapshot().repository, "/new-project");
});

test("switching into a chat exits project management and late writes cannot return to it", async (t) => {
  const { controller } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  controller.manageProjects();
  assert.equal(controller.getSnapshot().page, "projects");
  controller.applyScope({ panel_scope: { conversation_id: "chat" } }, false);
  assert.equal(controller.getSnapshot().page, "tasks");
  controller.manageProjects();
  assert.equal(controller.getSnapshot().page, "tasks");
  assert.equal(controller.getSnapshot().dialog, undefined);
  assert.equal(await controller.manageProject("/repo/a", "Renamed"), false);
});

test("another panel removing a project closes its confirmation and retains the Projects page", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  controller.manageProjects();
  const [project] = controller.getSnapshot().projects;
  assert.ok(project);
  controller.removeProject(project);
  assert.equal(controller.getSnapshot().dialog?.kind, "remove-project");
  transport.projects = [];
  await controller.refresh();
  assert.equal(controller.getSnapshot().dialog, undefined);
  assert.equal(controller.getSnapshot().page, "projects");
});

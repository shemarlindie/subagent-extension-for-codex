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
    if (name === "list_agent_projects" && reads++ === 0) return gate.promise;

    if (name === "remove_user_agent_project") {
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

test("other-panel removal clears selected project while renaming preserves scope", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  await controller.changeProject("/repo/a");
  controller.manageProjects();
  const version = controller.getSnapshot().scopeVersion;

  transport.handler = (name) => {
    if (name === "rename_user_agent_project") return { name: "Renamed" };
    if (name === "list_agent_projects")
      return [{ repository: "/repo/a", name: "Renamed", kind: "repository" }];

    return undefined;
  };

  await controller.manageProject("/repo/a", "Renamed");
  assert.equal(controller.getSnapshot().scopeVersion, version);
  assert.equal(controller.getSnapshot().projects[0].name, "Renamed");

  transport.handler = (name) =>
    name === "list_agent_projects" ? [] : undefined;

  await controller.refresh();
  assert.equal(controller.getSnapshot().repository, undefined);
  assert.equal(controller.getSnapshot().dialog, undefined);
});

test("global management cannot open in thread mode", async (t) => {
  const { controller } = setup();
  t.onTestFinished(() => controller.dispose());
  controller.applyScope({ panel_scope: { conversation_id: "chat" } }, false);
  await controller.start();
  controller.manageProjects();
  assert.equal(controller.getSnapshot().dialog, undefined);
  assert.equal(controller.getSnapshot().page, "tasks");
});

test("a project mutation finishing in another scope cannot leave the panel busy or select old work", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  controller.manageProjects();
  const gate = deferred<{ repository: string }>();

  transport.handler = (name) =>
    name === "remove_user_agent_project" ? gate.promise : undefined;

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
  assert.equal(await controller.manageProject("/repo/a", "Renamed"), false);
});

test("another panel removing a project closes its confirmation and retains the Projects page", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  controller.manageProjects();
  controller.removeProject(controller.getSnapshot().projects[0]);
  assert.equal(controller.getSnapshot().dialog?.kind, "remove-project");
  transport.projects = [];
  await controller.refresh();
  assert.equal(controller.getSnapshot().dialog, undefined);
  assert.equal(controller.getSnapshot().page, "projects");
});

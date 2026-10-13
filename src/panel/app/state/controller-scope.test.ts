import assert from "node:assert/strict";

import { test } from "vitest";

import { deferred, flush, setup, task } from "./controller-test-harness";
import { visibleTasks } from "./selectors";
import type { PanelData, Task } from "./types";

test("panel bootstrap explicitly requests global scope; host scope skips bootstrap and filters results", async (t) => {
  for (const explicit of [false, true]) {
    const { controller, transport } = setup();
    t.onTestFinished(() => controller.dispose());

    transport.tasks = [
      task("a", "/repo/a", "chat-a"),
      task("b", "/repo/a", "chat-b"),
      task("c", "/repo/b", "chat-a"),
    ];

    if (explicit)
      controller.applyScope(
        {
          panel_scope: {
            conversation_id: "chat-a",
            repository: "/repo/a",
            revision: "branch",
          },
        },
        false,
      );
    await controller.start();

    const bootstrap = transport.calls.filter(
      (call) => call.name === "get_agent_panel_context",
    );

    assert.equal(bootstrap.length, explicit ? 0 : 1);
    if (!explicit)
      assert.deepEqual(bootstrap[0].args, { conversation_id: null });

    assert.deepEqual(
      transport.calls.find((call) => call.name === "list_agent_tasks")?.args,
      explicit
        ? { conversation_id: "chat-a", repository: "/repo/a" }
        : { conversation_id: null },
    );

    assert.deepEqual(
      controller.getSnapshot().tasks.map((item) => item.id),
      explicit ? ["a"] : ["a", "b", "c"],
    );
  }
});

test("a project switch rejects an old list response and refreshes the current scope", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  const gate = deferred<Task[]>();

  transport.handler = (name, args) => {
    if (name === "list_agent_tasks" && args.repository === "/repo/b")
      return [task("new", "/repo/b")];
    if (name === "list_agent_tasks") return gate.promise;

    return undefined;
  };

  const oldRefresh = controller.refresh();
  await flush();
  await controller.changeProject("/repo/b");
  gate.resolve([task("stale")]);
  await oldRefresh;
  await flush();

  assert.deepEqual(
    controller.getSnapshot().tasks.map((item) => item.id),
    ["new"],
  );

  assert.equal(controller.getSnapshot().repository, "/repo/b");
});

test("sharing sends the selected task identity to the host", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];
  await controller.start();
  transport.events.host({ ...controller.getSnapshot().host, canShare: true });

  await controller.select("a");
  await controller.share();

  assert.deepEqual(transport.shared.slice(-2), [
    {
      selected_task: "a",
      selected_item: null,
      conversation_id: null,
      repository: "/repo/a",
      revision: "HEAD",
    },
    {
      selected_task: "a",
      selected_item: null,
      conversation_id: null,
      repository: "/repo/a",
      revision: "HEAD",
    },
  ]);
});

test("Back keeps scoped narrow panels on the task list through refresh", async (t) => {
  for (const scope of [
    { conversation_id: "chat" },
    { conversation_id: null, repository: "/repo/a" },
  ]) {
    const { controller, transport } = setup();
    t.onTestFinished(() => controller.dispose());
    transport.tasks = [task("a", "/repo/a", "chat")];
    controller.applyScope({ panel_scope: scope }, false);
    await controller.start();
    assert.equal(controller.getSnapshot().selected, "a");
    controller.back();
    await controller.refresh();
    assert.equal(controller.getSnapshot().selected, undefined);
    assert.deepEqual(controller.getSnapshot().events, []);
  }
});

test("All chats preserves repository and discards a delayed conversation response", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());

  controller.applyScope(
    {
      panel_scope: {
        conversation_id: "chat-a",
        repository: "/repo/a",
        revision: "feature",
      },
      panel_project_candidate: { repository: "/repo/chat-candidate" },
    },
    false,
  );

  transport.tasks = [task("a", "/repo/a", "chat-a")];
  await controller.start();

  assert.equal(
    controller.getSnapshot().projectCandidate,
    "/repo/chat-candidate",
  );

  controller.setFilter("attention");
  controller.setSearch("old search");
  const gate = deferred<Task[]>();

  transport.handler = (name, args) => {
    if (name === "list_agent_tasks" && args.conversation_id === "chat-a")
      return gate.promise;
    if (name === "list_agent_tasks")
      return [task("a", "/repo/a", "chat-a"), task("b", "/repo/a", "chat-b")];

    return undefined;
  };

  const oldRefresh = controller.refresh();
  await flush();
  await controller.allChats();
  gate.resolve([task("stale", "/repo/a", "chat-a")]);
  await oldRefresh;
  await flush();
  const state = controller.getSnapshot();
  assert.equal(state.conversation, undefined);
  assert.equal(state.repository, "/repo/a");
  assert.equal(state.revision, "feature");
  assert.equal(state.projectCandidate, undefined);
  assert.equal(state.filter, null);
  assert.equal(state.search, "");

  assert.deepEqual(
    state.tasks.map((item) => item.id),
    ["a", "b"],
  );

  assert.deepEqual(
    transport.calls.filter((call) => call.name === "list_agent_tasks").at(-1)
      ?.args,
    { conversation_id: null, repository: "/repo/a" },
  );
});

test("unrelated tool output leaves scope, selection and the open form intact", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a", "/repo/a", "chat")];

  controller.applyScope(
    { panel_scope: { conversation_id: "chat", repository: "/repo/a" } },
    false,
  );

  await controller.start();
  await controller.delegate();
  const before = controller.getSnapshot();
  controller.applyScope({} as PanelData, false);
  const after = controller.getSnapshot();
  assert.equal(after.scopeVersion, before.scopeVersion);
  assert.equal(after.selected, before.selected);
  assert.equal(after.dialog, before.dialog);
});

test("Failed filter shows failed, interrupted and live-failed tasks only", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  const failed = task("failed");
  failed.status = "failed";
  const interrupted = task("interrupted");
  interrupted.status = "interrupted";
  const liveFailed = task("live-failed");
  liveFailed.live_activity = { text: "Provider failed", state: "failed" };
  const done = task("done");
  done.status = "completed";
  transport.tasks = [failed, interrupted, liveFailed, done, task("ok")];

  await controller.start();
  controller.setFilter("failed");

  assert.deepEqual(
    visibleTasks(controller.getSnapshot()).map((item) => item.id),
    ["failed", "interrupted", "live-failed"],
  );
});

test("opening data selects the default task before the task-list read returns", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());

  const listRead = deferred<Task[]>();

  transport.handler = (name) =>
    name === "list_agent_tasks" ? listRead.promise : undefined;

  const done: Task = {
      ...task("done", "/repo/a", "chat"),
      status: "completed",
    },
    waiting: Task = {
      ...task("waiting", "/repo/a", "chat"),
      pending_input: { id: "q", tool: "ask", kind: "question", input: {} },
    };

  transport.tasks = [done, waiting];
  void controller.start();
  await flush();

  transport.events.scope({
    panel_scope: { conversation_id: "chat" },
    tasks: [done, waiting],
  });

  const snapshot = controller.getSnapshot();
  assert.equal(snapshot.taskListLoading, false);
  assert.equal(snapshot.selected, "waiting");
  assert.equal(snapshot.chatHistoryLoading, "waiting");

  listRead.resolve([done, waiting]);
  await flush();
  assert.equal(controller.getSnapshot().selected, "waiting");
});

test("opening data defers to the host selection and to narrow unscoped panels", (t) => {
  const hosted = setup(true);
  t.onTestFinished(() => hosted.controller.dispose());

  hosted.controller.applyScope(
    {
      panel_scope: { conversation_id: "chat" },
      tasks: [task("a", "/repo/a", "chat"), task("b", "/repo/a", "chat")],
      panel_selection: { task_id: "b" },
    },
    false,
  );

  assert.equal(hosted.controller.getSnapshot().selected, "b");

  const narrow = setup();
  t.onTestFinished(() => narrow.controller.dispose());

  narrow.controller.applyScope(
    { panel_scope: { conversation_id: null }, tasks: [task("a")] },
    false,
  );

  assert.equal(narrow.controller.getSnapshot().selected, undefined);
});

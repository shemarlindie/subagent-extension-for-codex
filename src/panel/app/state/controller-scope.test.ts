import assert from "node:assert/strict";

import { test } from "vitest";

import { deferred, flush, setup, task } from "./controller-test-harness";
import type { Task } from "./types";

test("panel bootstrap explicitly requests global scope; host scope skips bootstrap and filters results", async (t) => {
  for (const explicit of [false, true]) {
    const { controller, transport } = setup();
    t.onTestFinished(() => controller.dispose());

    transport.tasks = [
      task("a", "/repo/a", "chat-a"),
      task("b", "/repo/a", "chat-b"),
      task("c", "/repo/b", "chat-a"),
    ];

    if (explicit) {
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
    }

    await controller.start();

    const bootstrap = transport.calls.filter(
      (call) => call.name === "get_panel_context",
    );

    assert.equal(bootstrap.length, explicit ? 0 : 1);

    if (!explicit) {
      const [call] = bootstrap;
      assert.ok(call);
      assert.deepEqual(call.args, { conversation_id: null });
    }

    assert.deepEqual(
      transport.calls.find((call) => call.name === "app_list_tasks")?.args,
      explicit
        ? {
            conversation_id: "chat-a",
            repository: "/repo/a",
            archived: false,
            include: [],
          }
        : { conversation_id: null, archived: false, include: [] },
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
  const gate = deferred<{ tasks: Task[] }>();

  transport.handler = (name, args) => {
    if (name === "app_list_tasks" && args.repository === "/repo/b") {
      return { tasks: [task("new", "/repo/b")] };
    }

    if (name === "app_list_tasks") return gate.promise;

    return undefined;
  };

  const oldRefresh = controller.refresh();
  await flush();
  await controller.changeProject("/repo/b");
  gate.resolve({ tasks: [task("stale")] });
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
  const gate = deferred<{ tasks: Task[] }>();

  transport.handler = (name, args) => {
    if (name === "app_list_tasks" && args.conversation_id === "chat-a") {
      return gate.promise;
    }

    if (name === "app_list_tasks") {
      return {
        tasks: [task("a", "/repo/a", "chat-a"), task("b", "/repo/a", "chat-b")],
      };
    }

    return undefined;
  };

  const oldRefresh = controller.refresh();
  await flush();
  await controller.allChats();
  gate.resolve({ tasks: [task("stale", "/repo/a", "chat-a")] });
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
    transport.calls.filter((call) => call.name === "app_list_tasks").at(-1)
      ?.args,
    {
      conversation_id: null,
      repository: "/repo/a",
      archived: false,
      include: [],
    },
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
  controller.applyScope({}, false);
  const after = controller.getSnapshot();
  assert.equal(after.scopeVersion, before.scopeVersion);
  assert.equal(after.selected, before.selected);
  assert.equal(after.dialog, before.dialog);
});

test("malformed scope data is rejected and the task list waits for a valid scope", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());

  assert.equal(
    controller.applyScope({ panel_scope: { conversation_id: 42 } }, false),
    false,
  );

  assert.equal(
    controller.applyScope(
      { panel_scope: { conversation_id: null, repository: 7 } },
      false,
    ),
    false,
  );

  assert.equal(controller.getSnapshot().scopeKnown, false);

  // The bootstrap read returns no usable scope, so the list is never read.
  transport.context = { panel_scope: { conversation_id: 42 } };
  await controller.start();
  assert.equal(controller.getSnapshot().scopeKnown, false);
  assert.ok(!transport.calls.some((call) => call.name === "app_list_tasks"));

  assert.equal(
    controller.applyScope({ panel_scope: { conversation_id: "chat" } }, false),
    true,
  );

  assert.equal(controller.getSnapshot().conversation, "chat");
});

test("opening data selects the default task before the task-list read returns", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());

  const listRead = deferred<{ tasks: Task[] }>();

  transport.handler = (name) =>
    name === "app_list_tasks" ? listRead.promise : undefined;

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

  listRead.resolve({ tasks: [done, waiting] });
  await flush();
  assert.equal(controller.getSnapshot().selected, "waiting");
});

test("opening data keeps the task Chat is reading at its latest message read", (t) => {
  const { controller } = setup(true);
  t.onTestFinished(() => controller.dispose());

  controller.taskActions.unread.watch("a");

  controller.applyScope(
    {
      panel_scope: { conversation_id: "chat" },
      tasks: [
        { ...task("a", "/repo/a", "chat"), unread: true, read_through: 1 },
        { ...task("b", "/repo/a", "chat"), unread: true, read_through: 3 },
      ],
    },
    false,
  );

  assert.deepEqual(
    controller
      .getSnapshot()
      .tasks.map((item) => [item.id, item.unread, item.read_through]),
    [
      ["a", undefined, undefined],
      ["b", true, 3],
    ],
  );
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

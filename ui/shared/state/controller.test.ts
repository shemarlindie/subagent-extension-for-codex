import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { Controller } from "./controller";
import { visibleTasks } from "./selectors";
import type {
  Defaults,
  Event,
  PanelData,
  Task,
  Transport,
  TransportEvents,
} from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;

  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

const defaults: Defaults = {
  default_provider: "claude",
  default_worker_profile: "reviewer",
  max_runtime_minutes: 0.5,
  max_cost_usd: null,
};

function task(
  id: string,
  repository = "/repo/a",
  conversation_id?: string,
): Task {
  return {
    id,
    repository,
    conversation_id,
    revision: "HEAD",
    provider: "claude",
    worker_profile: "reviewer",
    title: "Review",
    description: "Review",
    depends_on: [],
    context: [],
    workspace_strategy: "worktree",
    budget: { max_runtime_minutes: 20, max_cost_usd: null },
    owner: "owner",
    status: "running",
    created_at: "",
    updated_at: "",
    instructions: [],
    attempt: 1,
    runtime_ms: 0,
  };
}

class FakeTransport implements Transport {
  embedded = true;
  events!: TransportEvents;
  calls: { name: string; args: Record<string, unknown> }[] = [];
  watches = 0;
  disposals = 0;
  connectGate?: Promise<void>;
  tasks: Task[] = [];
  context: PanelData = { panel_scope: { conversation_id: null } };
  projects = [{ repository: "/repo/a", kind: "repository" }];
  handler?: (name: string, args: Record<string, unknown>) => unknown;
  shared: Record<string, unknown>[] = [];
  async connect(events: TransportEvents) {
    this.events = events;
    await this.connectGate;
  }

  async tool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ name, args });
    const answer = this.handler?.(name, args);
    if (answer !== undefined) return (await answer) as T;

    const values: Record<string, unknown> = {
      get_agent_panel_context: this.context,
      list_agent_projects: this.projects,
      list_available_workers: [
        { provider: "claude", profiles: ["reviewer"], capabilities: {} },
      ],
      list_agent_tasks: this.tasks,
      get_agent_events: [],
      get_agent_settings: { values: defaults },
    };

    assert.ok(name in values, `Unexpected tool ${name}`);

    return values[name] as T;
  }

  async share(data: Record<string, unknown>) {
    this.shared.push(data);
  }

  watch() {
    this.watches++;
  }

  dispose() {
    this.disposals++;
  }
}

function setup(wide = false) {
  const transport = new FakeTransport();

  const environment = {
    hidden: () => false,
    wide: () => wide,
  };

  const controller = new Controller(transport, environment);

  return { transport, controller, environment };
}

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

  transport.handler = (name, args) =>
    name === "list_agent_tasks"
      ? args.repository === "/repo/b"
        ? [task("new", "/repo/b")]
        : gate.promise
      : undefined;

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

test("delayed detail from a previous selection cannot replace current events", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a"), task("b")];
  await controller.start();
  const gate = deferred<Event[]>();

  transport.handler = (name, args) =>
    name === "get_agent_events"
      ? args.task_id === "a"
        ? gate.promise
        : [{ id: 2, task_id: "b", type: "log", timestamp: "", data: {} }]
      : undefined;

  const first = controller.select("a");
  await controller.select("b");
  gate.resolve([{ id: 1, task_id: "a", type: "log", timestamp: "", data: {} }]);
  await first;
  assert.equal(controller.getSnapshot().selected, "b");

  assert.deepEqual(
    controller.getSnapshot().events.map((item) => item.task_id),
    ["b"],
  );
});

test("sharing sends the selected task and an optional selected item to the host", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];
  await controller.start();
  transport.events.host({ ...controller.getSnapshot().host, canShare: true });

  await controller.select("a");
  await controller.share({ kind: "file", path: "src/a.ts" });

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
      selected_item: { kind: "file", path: "src/a.ts" },
      conversation_id: null,
      repository: "/repo/a",
      revision: "HEAD",
    },
  ]);
});

test("refresh preserves dialog identity and reviewed defaults while discovering new projects", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  await controller.delegate();
  const dialog = controller.getSnapshot().dialog;
  assert.equal(dialog?.kind, "delegate");
  if (dialog?.kind !== "delegate") throw new Error("Expected delegate dialog");
  assert.equal(dialog.defaults.max_runtime_minutes, 0.5);
  assert.equal(dialog.defaults.max_cost_usd, null);

  transport.projects = [
    ...transport.projects,
    { repository: "/repo/b", kind: "repository" },
  ];

  await controller.refresh();
  assert.equal(controller.getSnapshot().dialog, dialog);
  assert.equal(controller.getSnapshot().projects.length, 2);
});

test("delegation project lookup discarded when conversation changes", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  const gate = deferred<typeof transport.projects>();

  transport.handler = (name) =>
    name === "list_agent_projects" ? gate.promise : undefined;

  const opening = controller.delegate();
  await flush();

  controller.applyScope(
    { panel_scope: { conversation_id: "another-chat" } },
    false,
  );

  gate.resolve(transport.projects);
  await opening;
  assert.equal(controller.getSnapshot().dialog, undefined);
});

test("in-flight mutation never selects its returned task after the host changes scope", async (t) => {
  const { controller } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  await controller.delegate();
  const original = controller.getSnapshot().dialog;
  const gate = deferred<Task>();
  const submitting = controller.submit(() => gate.promise, true);

  controller.applyScope(
    { panel_scope: { conversation_id: "new-chat", repository: "/repo/b" } },
    false,
  );

  assert.equal(controller.getSnapshot().busy, true);
  gate.resolve(task("old-outcome"));
  await submitting;
  assert.equal(controller.getSnapshot().selected, undefined);
  assert.equal(controller.getSnapshot().dialog, original);
  assert.equal(controller.getSnapshot().busy, false);
  assert.match(controller.getSnapshot().formError, /original scope/);
  let retryCalls = 0;

  await controller.submit(async () => {
    retryCalls++;
  });

  assert.equal(retryCalls, 0);
  assert.match(controller.getSnapshot().formError, /reopen/);
});

test("approved parent roots allow delegation in a scoped subrepository", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.projects = [{ repository: "/repo", kind: "parent" }];

  controller.applyScope(
    {
      panel_scope: {
        conversation_id: null,
        repository: "/repo/sub",
        revision: "feature",
      },
    },
    false,
  );

  await controller.start();
  await controller.delegate();
  assert.equal(controller.getSnapshot().dialog?.kind, "delegate");
  const dialog = controller.getSnapshot().dialog;

  if (dialog?.kind === "delegate") {
    assert.equal(dialog.repository, "/repo/sub");
    assert.equal(dialog.revision, "feature");
  }
});

test("automatic global history does not prefill delegation, while an intentional selection does", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("history", "/history")];

  transport.projects = [
    { repository: "/repo/a", kind: "repository" },
    { repository: "/repo/b", kind: "repository" },
  ];

  await controller.start();
  await controller.delegate();
  let dialog = controller.getSnapshot().dialog;

  assert.equal(
    dialog?.kind === "delegate" ? dialog.repository : "wrong dialog",
    undefined,
  );

  controller.dismiss();
  await controller.select("history");
  await controller.delegate();
  dialog = controller.getSnapshot().dialog;

  assert.equal(
    dialog?.kind === "delegate" ? dialog.repository : undefined,
    "/history",
  );
});

test("event pagination follows the server cursor and retains the latest 200 events", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];
  await controller.start();

  const events = Array.from({ length: 1005 }, (_, i) => ({
    id: i + 1,
    task_id: "a",
    type: "log",
    timestamp: "",
    data: {},
  }));

  transport.handler = (name, args) =>
    name === "get_agent_events"
      ? events.filter((item) => item.id > Number(args.after)).slice(0, 1000)
      : undefined;

  await controller.select("a");

  assert.deepEqual(
    controller.getSnapshot().events.map((item) => item.id),
    events.slice(-200).map((item) => item.id),
  );

  assert.deepEqual(
    transport.calls
      .filter((call) => call.name === "get_agent_events")
      .map((call) => call.args.after),
    [0, 1000],
  );

  await controller.refresh();

  assert.equal(
    transport.calls.filter((call) => call.name === "get_agent_events").at(-1)
      ?.args.after,
    1005,
  );

  assert.equal(controller.getSnapshot().events.length, 200);
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

for (const phase of ["connect", "read", "poll"] as const) {
  test(`host teardown during ${phase} stops further reads and polling`, async (t) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    t.onTestFinished(() => {
      vi.useRealTimers();
    });

    const { controller, transport } = setup();
    t.onTestFinished(() => controller.dispose());
    const gate = deferred<void>();
    if (phase === "connect") transport.connectGate = gate.promise;
    if (phase === "read")
      transport.handler = (name) =>
        name === "list_available_workers"
          ? gate.promise.then(() => [])
          : undefined;
    const starting = controller.start();
    await flush();

    if (phase === "poll") {
      await starting;

      transport.handler = (name) =>
        name === "list_agent_tasks" ? gate.promise.then(() => []) : undefined;

      vi.advanceTimersByTime(5000);
      await flush();
    }

    transport.events.teardown();
    const calls = transport.calls.length;
    gate.resolve();
    await starting;
    await flush();
    vi.advanceTimersByTime(30000);
    await flush();
    assert.equal(transport.calls.length, calls);
    assert.equal(transport.watches, phase === "poll" ? 1 : 0);
    assert.equal(transport.disposals, 1);
    await assert.rejects(controller.tool("list_agent_tasks"), /closed/);
  });
}

test("embedded polling skips hidden panels and waits for a pending refresh", async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  const { controller, transport, environment } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  let hidden = true;
  environment.hidden = () => hidden;
  const initial = transport.calls.length;
  vi.advanceTimersByTime(5000);
  await flush();
  assert.equal(transport.calls.length, initial);
  hidden = false;
  const gate = deferred<Task[]>();

  transport.handler = (name) =>
    name === "list_agent_tasks" ? gate.promise : undefined;

  vi.advanceTimersByTime(5000);
  await flush();
  const pending = transport.calls.length;
  // Each refresh reads the project list, then the tasks.
  assert.equal(pending, initial + 2);
  vi.advanceTimersByTime(30000);
  await flush();
  assert.equal(transport.calls.length, pending);
  gate.resolve([]);
  await flush();
  vi.advanceTimersByTime(5000);
  await flush();
  assert.equal(transport.calls.length, pending + 2);
});

test("embedded polling reports tool failures then retries successfully", async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  await controller.start();
  let fails = true;

  transport.handler = (name) =>
    name === "list_agent_tasks" && fails
      ? Promise.reject(new Error("Host temporarily unavailable"))
      : undefined;

  vi.advanceTimersByTime(5000);
  await flush();
  assert.equal(controller.getSnapshot().connection, "Reconnecting…");
  assert.match(controller.getSnapshot().error, /temporarily unavailable/);
  fails = false;
  vi.advanceTimersByTime(5000);
  await flush();

  assert.equal(
    controller.getSnapshot().connection,
    "Connected · refreshes every 5s",
  );

  assert.equal(controller.getSnapshot().error, "");
});

test("embedded startup schedules a retry when its first read fails", async (t) => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

  t.onTestFinished(() => {
    vi.useRealTimers();
  });

  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  let fails = true;

  transport.handler = (name) =>
    name === "list_agent_tasks" && fails
      ? Promise.reject(new Error("Host temporarily unavailable"))
      : undefined;

  await controller.start();
  assert.equal(controller.getSnapshot().connection, "Reconnecting…");
  assert.match(controller.getSnapshot().error, /temporarily unavailable/);
  assert.equal(transport.watches, 0);

  fails = false;

  const previousReads = transport.calls.filter(
    (call) => call.name === "list_agent_tasks",
  ).length;

  vi.advanceTimersByTime(5000);
  await flush();

  assert.equal(
    transport.calls.filter((call) => call.name === "list_agent_tasks").length,
    previousReads + 1,
  );

  assert.equal(
    controller.getSnapshot().connection,
    "Connected · refreshes every 5s",
  );

  assert.equal(controller.getSnapshot().error, "");
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

  transport.handler = (name, args) =>
    name === "list_agent_tasks"
      ? args.conversation_id === "chat-a"
        ? gate.promise
        : [task("a", "/repo/a", "chat-a"), task("b", "/repo/a", "chat-b")]
      : undefined;

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

test("New task offers the chat project only when auto-add is on and adds it before starting", async (t) => {
  for (const auto of [false, true]) {
    const { controller, transport } = setup();
    t.onTestFinished(() => controller.dispose());

    controller.applyScope(
      {
        panel_scope: { conversation_id: "chat-a" },
        panel_project_candidate: {
          repository: "/repo/chat",
          auto_register: auto,
        },
      },
      false,
    );

    await controller.start();
    await controller.delegate();
    const dialog = controller.getSnapshot().dialog;
    assert.equal(dialog?.kind, "delegate");
    if (dialog?.kind === "delegate")
      assert.equal(dialog.repository, auto ? "/repo/chat" : "/repo/a");
    // A registered project never triggers registration.
    await controller.addChatProjectForTask("/repo/a");

    transport.handler = (name) =>
      name === "list_agent_projects"
        ? [
            ...transport.projects,
            { repository: "/repo/chat", kind: "repository" },
          ]
        : name === "register_user_agent_project"
          ? { repository: "/repo/chat", kind: "repository" }
          : undefined;

    await controller.addChatProjectForTask("/repo/chat");

    const registrations = transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    );

    assert.deepEqual(
      registrations.map((call) => call.args),
      auto ? [{ repository: "/repo/chat" }] : [],
    );

    assert.equal(
      controller.getSnapshot().projectCandidate,
      auto ? undefined : "/repo/chat",
    );
  }
});

test("Failed filter shows failed, unconfirmed and live-failed tasks only", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  const failed = task("failed");
  failed.status = "failed";
  const unconfirmed = task("unconfirmed");
  unconfirmed.status = "failed";
  unconfirmed.waiting_reason = "termination_unconfirmed";
  const liveFailed = task("live-failed");
  liveFailed.live_activity = { text: "Provider failed", state: "failed" };
  const done = task("done");
  done.status = "completed";
  const cancelled = task("cancelled");
  cancelled.status = "cancelled";

  transport.tasks = [
    failed,
    unconfirmed,
    liveFailed,
    done,
    cancelled,
    task("ok"),
  ];

  await controller.start();
  controller.setFilter("failed");

  assert.deepEqual(
    visibleTasks(controller.getSnapshot()).map((item) => item.id),
    ["failed", "unconfirmed", "live-failed"],
  );
});

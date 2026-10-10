import assert from "node:assert/strict";

import { test, vi } from "vitest";

import { windowActivity } from "../../../shared/tasks/activity/activity-tail";
import type { Changes } from "../../features/changes/types";
import { Controller } from "./controller";
import { effectiveFilter, visibleTasks } from "./selectors";
import type {
  Defaults,
  PanelData,
  Task,
  Transport,
  TransportEvents,
  UiStatePersistence,
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
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
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
      get_user_agent_activity: { events: [] },
      get_user_agent_change_counts: {
        scope: "task",
        files: 0,
        additions: 0,
        deletions: 0,
      },
      get_user_agent_chat: { items: [], next_cursor: 0 },
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

test("browser view state seeds the first render, restores a task, and persists list navigation", async (t) => {
  const transport = new FakeTransport();

  transport.projects = [
    { repository: "/repo/a", kind: "repository" },
    { repository: "/repo/b", kind: "repository" },
  ];

  const selectedTask = task("b", "/repo/b");
  selectedTask.title = "Migrate config";
  transport.tasks = [task("a", "/repo/a"), selectedTask];
  const saved: UiStatePersistence["initial"][] = [];

  const viewState: UiStatePersistence = {
    initial: {
      view: {
        repository: "/repo/b",
        selected: "b",
        filter: "active",
        search: "Migrate",
        tab: "details",
      },
    },
    save: (state) => saved.push(state),
  };

  const controller = new Controller(
    transport,
    { hidden: () => false, wide: () => true },
    viewState,
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
    transport.calls.find((call) => call.name === "list_agent_tasks")?.args,
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

test("restores saved dialogs in order and removes each deliberate close", async (t) => {
  const transport = new FakeTransport();
  transport.tasks = [task("task-1")];
  const saved: UiStatePersistence["initial"][] = [];

  const controller = new Controller(
    transport,
    { hidden: () => false, wide: () => true },
    {
      initial: {
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
            draft: { message: "continue the migration" },
          },
        ],
      },
      save: (state) => saved.push(state),
    },
  );

  t.onTestFinished(() => controller.dispose());

  await controller.start();
  assert.equal(controller.getSnapshot().dialog?.kind, "handoff");

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

test("form updates preserve other state saved for the same dialog", (t) => {
  const { controller } = setup();
  t.onTestFinished(() => controller.dispose());

  controller.open({ kind: "handoff", task: task("task-1") });
  controller.saveDialogField("handoff", "openSections", ["advanced"]);
  controller.saveDialogDraft("handoff", { message: "keep going" });

  assert.deepEqual(controller.getDialogDraft("handoff"), {
    openSections: ["advanced"],
    message: "keep going",
  });
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
  const saved: UiStatePersistence["initial"][] = [];

  const controller = new Controller(
    transport,
    { hidden: () => false, wide: () => true },
    {
      initial: {
        view: { filter: "active", search: "Migrate", browsing: true },
      },
      save: (state) => saved.push(state),
    },
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

  controller.setFilter("failed");
  controller.setSearch("completed");

  assert.equal(controller.getSnapshot().filter, "failed");
  assert.equal(effectiveFilter(controller.getSnapshot()), "failed");
  assert.deepEqual(visibleTasks(controller.getSnapshot()), []);
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
  const gate = deferred<unknown>();

  transport.handler = (name, args) =>
    name === "get_user_agent_activity"
      ? args.task_id === "a"
        ? gate.promise
        : {
            events: [
              { id: 2, task_id: "b", type: "log", timestamp: "", data: {} },
            ],
          }
      : undefined;

  const first = controller.select("a");
  await controller.select("b");

  gate.resolve({
    events: [{ id: 1, task_id: "a", type: "log", timestamp: "", data: {} }],
  });

  await first;
  assert.equal(controller.getSnapshot().selected, "b");

  assert.deepEqual(
    controller.getSnapshot().events.map((item) => item.task_id),
    ["b"],
  );
});

test("each task remembers its tab across switching tasks and closing the inspector", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a"), task("b"), task("new")];
  await controller.start();

  await controller.select("a");
  controller.setTab("activity");
  await controller.select("b");
  assert.equal(controller.getSnapshot().tab, "chat");

  await controller.select("a");
  assert.equal(controller.getSnapshot().tab, "activity");
  controller.back();
  await controller.select("a");
  assert.equal(controller.getSnapshot().tab, "activity");

  await controller.select("new");
  assert.equal(controller.getSnapshot().tab, "chat");
  await controller.select("b");
  assert.equal(controller.getSnapshot().tab, "chat");
});

test("host selections restore a task's remembered tab unless they explicitly request another", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a"), task("b")];
  await controller.start();
  await controller.select("a");
  controller.setTab("activity");
  await controller.select("b");

  controller.applyScope(
    {
      panel_scope: { conversation_id: null },
      panel_selection: { task_id: "a" },
    },
    false,
  );

  assert.equal(controller.getSnapshot().tab, "activity");

  controller.applyScope(
    {
      panel_scope: { conversation_id: null },
      panel_selection: { task_id: "a", tab: "chat" },
    },
    false,
  );

  assert.equal(controller.getSnapshot().tab, "chat");
  await controller.select("b");
  await controller.select("a");
  assert.equal(controller.getSnapshot().tab, "chat");
});

// The Changes tab reads every change; Details reads only the totals.
for (const tab of ["changes", "details"] as const)
  test(`returning to a remembered ${tab} tab reads that task's changes`, async (t) => {
    const { controller, transport } = setup();
    t.onTestFinished(() => controller.dispose());
    transport.tasks = [task("a"), task("b")];

    transport.handler = (name, args) =>
      name === "get_user_agent_changes"
        ? {
            scope: "task",
            files: [],
            additions: args.task_id === "a" ? 1 : 2,
            deletions: 0,
            diff: "",
          }
        : name === "get_user_agent_change_counts"
          ? {
              scope: "task",
              files: 0,
              additions: args.task_id === "a" ? 1 : 2,
              deletions: 0,
            }
          : undefined;

    await controller.start();
    await controller.select("a");
    controller.setTab(tab);
    await flush();
    await controller.select("b");
    controller.setTab(tab);
    await flush();
    transport.calls = [];

    await controller.select("a");
    await flush();

    assert.equal(controller.getSnapshot().tab, tab);
    assert.equal(controller.getSnapshot().changeCounts?.task, "a");
    assert.equal(controller.getSnapshot().changeCounts?.data?.additions, 1);

    assert.equal(
      controller.getSnapshot().changes?.task,
      tab === "changes" ? "a" : undefined,
    );

    const readsOf = (name: string) =>
      transport.calls
        .filter((call) => call.name === name)
        .map((call) => call.args.task_id);

    assert.deepEqual(readsOf("get_user_agent_change_counts"), ["a"]);

    assert.deepEqual(
      readsOf("get_user_agent_changes"),
      tab === "changes" ? ["a"] : [],
    );
  });

test("a host link opens the Changes tab, and a read for a replaced task is dropped", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a"), task("b")];
  const gate = deferred<unknown>();

  const changes = (id: string) => ({
    scope: "task",
    files: [],
    additions: id === "a" ? 1 : 2,
    deletions: 0,
    diff: "",
  });

  transport.handler = (name, args) =>
    name === "get_user_agent_changes"
      ? args.task_id === "a"
        ? gate.promise
        : changes("b")
      : undefined;

  await controller.start();

  controller.applyScope(
    {
      panel_scope: { conversation_id: null },
      panel_selection: { task_id: "a", tab: "changes" },
    },
    false,
  );

  assert.equal(controller.getSnapshot().tab, "changes");
  const first = controller.loadChanges();
  await controller.select("b");
  controller.setTab("changes");
  await flush();
  gate.resolve(changes("a"));
  await first;

  assert.equal(controller.getSnapshot().changes?.task, "b");
  assert.equal(controller.getSnapshot().changes?.data?.additions, 2);
});

test("same-scope refresh retains the last changes while reading and after failure; scope switches clear them", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];

  const data: Changes = {
    scope: "task",
    files: [],
    additions: 3,
    deletions: 0,
    diff: "",
  };

  transport.handler = (name) =>
    name === "get_user_agent_changes" ? data : undefined;

  await controller.start();
  await controller.select("a");
  await controller.loadChanges();
  const lastLoaded = controller.getSnapshot().changes?.data;
  const refreshGate = deferred<Changes>();

  transport.handler = (name) =>
    name === "get_user_agent_changes" ? refreshGate.promise : undefined;

  const refresh = controller.loadChanges();

  assert.equal(controller.getSnapshot().changes?.loading, true);
  assert.equal(controller.getSnapshot().changes?.data, lastLoaded);
  refreshGate.reject(new Error("Git read failed"));
  await refresh;
  assert.equal(controller.getSnapshot().changes?.loading, false);
  assert.equal(controller.getSnapshot().changes?.data, lastLoaded);
  assert.equal(controller.getSnapshot().changes?.error, "Git read failed");

  const scopeGate = deferred<Changes>();

  transport.handler = (name) =>
    name === "get_user_agent_changes" ? scopeGate.promise : undefined;

  const switching = controller.loadChanges("turn");

  assert.equal(controller.getSnapshot().changes?.scope, "turn");
  assert.equal(controller.getSnapshot().changes?.loading, true);
  assert.equal(controller.getSnapshot().changes?.data, undefined);
  assert.equal(controller.getSnapshot().changes?.error, undefined);
  scopeGate.reject(new Error("Turn read failed"));
  await switching;
  assert.equal(controller.getSnapshot().changes?.loading, false);
  assert.equal(controller.getSnapshot().changes?.data, undefined);
  assert.equal(controller.getSnapshot().changes?.error, "Turn read failed");
});

test("a delayed changes refresh cannot replace a newer scope read", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];
  await controller.start();
  await controller.select("a");
  const gate = deferred<Changes>();

  const turn: Changes = {
    scope: "turn",
    files: [],
    additions: 2,
    deletions: 0,
    diff: "",
  };

  transport.handler = (name, args) =>
    name === "get_user_agent_changes"
      ? args.scope === "task"
        ? gate.promise
        : turn
      : undefined;

  const oldRead = controller.loadChanges("task");
  await controller.loadChanges("turn");
  gate.resolve({ ...turn, scope: "task", additions: 99 });
  await oldRead;

  assert.equal(controller.getSnapshot().changes?.scope, "turn");
  assert.equal(controller.getSnapshot().changes?.data?.additions, 2);
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
  let navigated = false;

  const submitting = controller.submit(
    () => gate.promise,
    true,
    () => {
      navigated = true;
    },
  );

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
  assert.equal(navigated, false);
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

test("the activity view shows the service's window and its tally, and polls for new events", async (t) => {
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
    name === "get_user_agent_activity"
      ? windowActivity(events, Number(args.after))
      : undefined;

  await controller.select("a");

  assert.deepEqual(
    controller.getSnapshot().events.map((item) => item.id),
    events.slice(-200).map((item) => item.id),
  );

  assert.equal(controller.getSnapshot().droppedEvents?.count, 805);

  assert.deepEqual(
    transport.calls
      .filter((call) => call.name === "get_user_agent_activity")
      .map((call) => call.args.after),
    [0],
  );

  await controller.refresh();

  assert.equal(
    transport.calls
      .filter((call) => call.name === "get_user_agent_activity")
      .at(-1)?.args.after,
    1005,
  );

  assert.equal(controller.getSnapshot().events.length, 200);
});

test("tab counts load without reading the event log or the Changes tab", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];

  transport.handler = (name) =>
    name === "get_user_agent_change_counts"
      ? { scope: "task", files: 4, additions: 9, deletions: 2 }
      : undefined;

  await controller.start();
  await controller.select("a");
  await flush();

  assert.equal(controller.getSnapshot().changeCounts?.data?.files, 4);
  assert.equal(controller.getSnapshot().changes, undefined);

  const names = transport.calls.map((call) => call.name);

  assert.ok(names.includes("get_user_agent_change_counts"));
  assert.ok(!names.includes("get_user_agent_changes"));
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

test("the panel follows a running task's draft by chained reads, then reads the stored message", async (t) => {
  const { controller, transport } = setup(true);
  t.onTestFinished(() => controller.dispose());
  transport.tasks = [task("a")];
  const drafts = ["Hel", "Hello", "Hello there"];

  transport.handler = (name, args) => {
    if (name !== "get_user_agent_draft") return undefined;
    const text = drafts.shift();

    // After the last piece the message is stored and the turn has ended.
    return Promise.resolve(
      text
        ? { draft: { message_id: "m", text }, running: true }
        : { draft: null, running: false },
    ).then((read) => {
      assert.equal(args.wait_ms, 20000);

      return read;
    });
  };

  // A wide panel selects the running task on start.
  await controller.start();
  assert.equal(controller.getSnapshot().selected, "a");

  await vi.waitFor(() =>
    assert.ok(
      transport.calls.filter((call) => call.name === "get_user_agent_draft")
        .length >= 4,
    ),
  );

  const reads = transport.calls
    .filter((call) => call.name === "get_user_agent_draft")
    .map((call) => [call.args.message_id, call.args.after_length])
    .slice(0, 4);

  // Each read asks only for what follows the draft it has.
  assert.deepEqual(reads, [
    [undefined, undefined],
    ["m", 3],
    ["m", 5],
    ["m", 11],
  ]);

  await vi.waitFor(() =>
    assert.equal(controller.getSnapshot().draft, undefined),
  );
});

test("workers are read again each refresh while one can't start tasks, and otherwise each hour", async (t) => {
  const { controller, transport } = setup();
  t.onTestFinished(() => controller.dispose());

  let ready = false;

  transport.handler = (name) =>
    name === "list_available_workers"
      ? [
          {
            provider: "claude",
            profiles: ["reviewer"],
            capabilities: {},
            readiness: ready
              ? { ready: true, details: {} }
              : { ready: false, message: "Claude Code not found", details: {} },
          },
        ]
      : undefined;

  const workerReads = () =>
    transport.calls.filter((call) => call.name === "list_available_workers")
      .length;

  await controller.start();
  await controller.refresh();
  assert.equal(workerReads(), 2);

  ready = true;
  await controller.refresh();
  assert.equal(workerReads(), 3);
  assert.equal(controller.getSnapshot().workers[0].readiness?.ready, true);

  await controller.refresh();
  assert.equal(workerReads(), 3);

  // Within the hour, a ready list is reused.
  const start = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(start + 59 * 60_000);
  await controller.refresh();
  assert.equal(workerReads(), 3);
  clock.mockRestore();

  // A ready list is still read again after an hour, so a runtime that breaks shows.
  const now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 60 * 60_000 + 1000);
  ready = false;
  await controller.refresh();
  assert.equal(workerReads(), 4);
  assert.equal(controller.getSnapshot().workers[0].readiness?.ready, false);
});

test("the file preview moves between changed files and saves where it is", async (t) => {
  const transport = new FakeTransport();
  transport.tasks = [task("task-1")];
  const saved: UiStatePersistence["initial"][] = [];

  const controller = new Controller(
    transport,
    { hidden: () => false, wide: () => true },
    { initial: { view: {} }, save: (state) => saved.push(state) },
  );

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

test("permission decisions submit the request id and optional worker message", async (t) => {
  const { controller, transport } = setup();

  t.onTestFinished(() => controller.dispose());

  transport.handler = (name) =>
    name === "submit_agent_input" ? {} : undefined;

  const pendingTask: Task = {
    ...task("task-1"),
    pending_input: {
      id: "request-1",
      tool: "Bash",
      kind: "permission",
      input: { command: "npm run typecheck" },
    },
  };

  await controller.decidePermission(pendingTask, true, "Run only the checks.");

  assert.deepEqual(transport.calls, [
    {
      name: "submit_agent_input",
      args: {
        task_id: "task-1",
        request_id: "request-1",
        approved: true,
        message: "Run only the checks.",
      },
    },
  ]);
});

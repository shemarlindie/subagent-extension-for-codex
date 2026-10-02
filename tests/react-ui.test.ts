import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { JSDOM } from "jsdom";
import type {
  HostState,
  Task,
  Transport,
  TransportEvents,
} from "../ui/core/types";

// UI primitives read browser capabilities at module initialization.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "NodeFilter",
  "DocumentFragment",
  "MutationObserver",
  "CustomEvent",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLTextAreaElement",
  "HTMLButtonElement",
  "HTMLFormElement",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: (dom.window as any)[key],
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});
const { createElement } = await import("react");
const { act, render, screen, cleanup, waitFor } =
  await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const { Controller } = await import("../ui/core/controller");
const { ControllerContext } =
  await import("../ui/components/controller-context");
const { AppShell } = await import("../ui/shells/app-shell");

function task(id = "one", repository = "/repo/a"): Task {
  return {
    id,
    repository,
    revision: "feature",
    provider: "claude",
    worker_profile: "reviewer",
    task: "Review authentication",
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
  preview = true;
  events!: TransportEvents;
  tasks = [task()];
  projects = [{ repository: "/repo/a", kind: "repository" }];
  calls: { name: string; args: Record<string, unknown> }[] = [];
  messages: string[] = [];
  host: HostState = {
    canSend: false,
    canShare: false,
    canExpand: true,
    displayMode: "fullscreen",
  };
  expandCalls = 0;
  async connect(events: TransportEvents) {
    this.events = events;
    events.host(this.host);
  }
  async expand() {
    this.expandCalls++;
    this.host = {
      ...this.host,
      displayMode: this.host.displayMode === "inline" ? "fullscreen" : "inline",
    };
    this.events.host(this.host);
  }
  async tool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ name, args });
    const values: Record<string, unknown> = {
      get_agent_panel_context: { panel_scope: { conversation_id: null } },
      list_agent_projects: this.projects,
      list_available_workers: [
        {
          provider: "claude",
          profiles: ["reviewer"],
          capabilities: { cost_budget: true },
        },
        {
          provider: "codex",
          profiles: ["reviewer"],
          capabilities: { cost_budget: false },
        },
      ],
      list_agent_tasks: this.tasks,
      get_agent_events: [],
      get_agent_artifacts: [],
      get_agent_settings: {
        values: {
          default_provider: "claude",
          default_worker_profile: "reviewer",
          max_runtime_minutes: 0.5,
          max_cost_usd: null,
        },
      },
      start_agent_task: this.tasks[0],
      submit_agent_input: {},
    };
    assert.ok(name in values, `Unexpected tool ${name}`);
    return values[name] as T;
  }
  async send(message: string) {
    this.messages.push(message);
  }
  watch() {}
  dispose() {}
}
async function setup(
  t: TestContext,
  configure?: (transport: FakeTransport) => void,
  options: {
    mode?: "panel" | "console";
    wide?: boolean;
    scoped?: boolean;
    displayMode?: HostState["displayMode"];
    start?: boolean;
  } = {},
) {
  const transport = new FakeTransport();
  if (options.displayMode) transport.host.displayMode = options.displayMode;
  configure?.(transport);
  const controller = new Controller(transport, options.mode ?? "panel", {
    hidden: () => false,
    wide: () => options.wide ?? true,
    path: "/",
    navigate: () => {},
  });
  if (options.scoped)
    controller.applyScope(
      { panel_scope: { conversation_id: null, repository: "/repo/a" } },
      false,
    );
  if (options.start !== false) await controller.start();
  function Harness() {
    return createElement(
      ControllerContext.Provider,
      { value: controller },
      createElement(AppShell),
    );
  }
  render(createElement(Harness));
  t.after(() => {
    cleanup();
    controller.dispose();
  });
  const user = userEvent.setup({ document: dom.window.document });
  return { controller, transport, user };
}

async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
  multiple = false,
) {
  const trigger = screen.getByRole("combobox", { name: label, exact: true });
  await user.click(trigger);
  await user.click(
    await screen.findByRole("option", { name: option, exact: true }),
  );
  if (multiple) await user.keyboard("{Escape}");
  await waitFor(() =>
    assert.equal(trigger.getAttribute("aria-expanded"), "false"),
  );
}

test("inline preview expands and collapses while preserving the selected task", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) => {
      const second = task("two");
      second.task = "Review database";
      transport.tasks.push(second);
    },
    { displayMode: "inline" },
  );
  await act(() => controller.select("two"));
  assert.ok(screen.getByText("Review database"));
  assert.ok(screen.getByText("Running", { exact: true }));
  assert.equal(screen.queryByRole("button", { name: "New task" }), null);
  assert.equal(screen.queryByRole("region", { name: "Task inspector" }), null);
  assert.equal(
    screen.queryByRole("complementary", { name: "Delegated tasks" }),
    null,
  );
  await user.click(screen.getByRole("button", { name: "Open panel" }));
  assert.equal(transport.expandCalls, 1);
  assert.equal(controller.getSnapshot().selected, "two");
  assert.ok(screen.getByRole("button", { name: "New task" }));
  assert.equal(
    screen.getByRole("heading", { level: 1 }).textContent,
    "Review database",
  );
  await user.click(screen.getByRole("button", { name: "Collapse" }));
  assert.equal(transport.expandCalls, 2);
  assert.equal(controller.getSnapshot().selected, "two");
  assert.ok(screen.getByText("Review database"));
  assert.ok(screen.getByRole("button", { name: "Open panel" }));
  assert.equal(screen.queryByRole("region", { name: "Task inspector" }), null);
});

test("inline host without expansion offers the chat controls fallback", async (t) => {
  await setup(
    t,
    (transport) => {
      transport.host.canExpand = false;
    },
    { displayMode: "inline" },
  );
  assert.equal(screen.queryByRole("button", { name: "Open panel" }), null);
  assert.ok(screen.getByText("Expand this app using the chat controls."));
  assert.equal(screen.queryByRole("button", { name: "New task" }), null);
});

test("failed expansion keeps the inline preview and displays the host error", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) => {
      transport.expand = async () => {
        transport.expandCalls++;
        throw new Error("Panel expansion unavailable");
      };
    },
    { displayMode: "inline" },
  );
  await user.click(screen.getByRole("button", { name: "Open panel" }));
  await screen.findByRole("alert");
  assert.equal(
    screen.getByRole("alert").textContent,
    "Panel expansion unavailable",
  );
  assert.equal(transport.expandCalls, 1);
  assert.equal(controller.getSnapshot().host.displayMode, "inline");
  assert.ok(screen.getByRole("button", { name: "Open panel" }));
  assert.equal(screen.queryByRole("region", { name: "Task inspector" }), null);
});

test("host collapse preserves a delegation draft until scope changes", async (t) => {
  const { controller, transport, user } = await setup(t);
  await user.click(screen.getByRole("button", { name: "New task" }));
  const field = await screen.findByLabelText("Task");
  await user.type(field, "Preserve this suspended draft");
  const dialogState = controller.getSnapshot().dialog;
  await act(() => transport.expand());
  assert.ok(screen.getByRole("region", { name: "Delegated work preview" }));
  assert.equal(screen.queryByRole("dialog"), null);
  assert.ok(controller.getSnapshot().dialog === dialogState);
  await user.click(screen.getByRole("button", { name: "Open panel" }));
  await screen.findByRole("dialog");
  assert.ok(
    screen.getByLabelText("Task") === field,
    "Host expansion retains the draft field node",
  );
  assert.equal(
    (field as HTMLTextAreaElement).value,
    "Preserve this suspended draft",
  );
  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
  await act(() => transport.expand());
  assert.equal(screen.queryByRole("dialog"), null);
  await act(() => controller.changeProject("/repo/b"));
  assert.equal(controller.getSnapshot().dialog, undefined);
  await user.click(screen.getByRole("button", { name: "Open panel" }));
  assert.equal(screen.queryByRole("dialog"), null);
  await user.click(screen.getAllByRole("button", { name: "New task" })[0]);
  await screen.findByRole("dialog");
  assert.equal(
    (screen.getByLabelText("Task") as HTMLTextAreaElement).value,
    "",
  );
  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
});

test("console and nonembedded panels retain the full interface in inline mode", async (t) => {
  await t.test("console", async (t) => {
    await setup(t, undefined, { mode: "console", displayMode: "inline" });
    assert.ok(screen.getByRole("button", { name: "＋ Delegate" }));
    assert.ok(screen.getByRole("region", { name: "Task inspector" }));
    assert.equal(screen.queryByRole("button", { name: "Open panel" }), null);
  });
  await t.test("nonembedded panel", async (t) => {
    await setup(
      t,
      (transport) => {
        transport.embedded = false;
      },
      { displayMode: "inline" },
    );
    assert.ok(screen.getByRole("button", { name: "New task" }));
    assert.ok(screen.getByRole("region", { name: "Task inspector" }));
    assert.equal(screen.queryByRole("button", { name: "Open panel" }), null);
  });
});

test("inline preview renders refresh errors without exposing the full interface", async (t) => {
  const { controller } = await setup(t, undefined, { displayMode: "inline" });
  await act(() => controller.report(new Error("Refresh unavailable")));
  assert.equal(screen.getByRole("alert").textContent, "Refresh unavailable");
  assert.ok(screen.getByText("Review authentication"));
  assert.ok(screen.getByRole("button", { name: "Open panel" }));
  assert.equal(screen.queryByRole("region", { name: "Task inspector" }), null);
});

test("inline preview summarizes repository scope independently of list filters", async (t) => {
  const { controller } = await setup(
    t,
    (transport) => {
      const waiting = task("waiting");
      waiting.task = "Waiting review";
      waiting.status = "waiting";
      waiting.pending_input = {
        id: "request",
        tool: "AskUserQuestion",
        input: {},
      };
      const stopped = task("stopped");
      stopped.status = "failed";
      stopped.waiting_reason = "termination_unconfirmed";
      const complete = task("complete");
      complete.status = "completed";
      transport.tasks.push(
        waiting,
        stopped,
        complete,
        task("other", "/repo/b"),
      );
    },
    { displayMode: "inline", scoped: true },
  );
  await act(() => {
    controller.setFilter("completed");
    controller.setSearch("no matching task");
  });
  assert.equal(
    screen.getByRole("status").textContent,
    "4 tasks · 2 active · 2 needing attention",
  );
  assert.ok(screen.getByText("Waiting review"));
  assert.ok(screen.getByText("Needs input", { exact: true }));
  assert.equal(screen.queryByRole("region", { name: "Task inspector" }), null);
});

test("inline preview distinguishes empty tasks from connecting state", async (t) => {
  await t.test("empty", async (t) => {
    await setup(
      t,
      (transport) => {
        transport.tasks = [];
      },
      { displayMode: "inline" },
    );
    assert.equal(
      screen.getByRole("status").textContent,
      "0 tasks · 0 active · 0 needing attention",
    );
    assert.ok(screen.getByText("No delegated tasks yet."));
    assert.ok(screen.getByRole("button", { name: "Open panel" }));
  });
  await t.test("connecting", async (t) => {
    await setup(t, undefined, { start: false });
    assert.ok(screen.getByRole("region", { name: "Delegated work preview" }));
    assert.equal(screen.getByRole("status").textContent, "Connecting…");
    assert.equal(screen.queryByText("No delegated tasks yet."), null);
    assert.equal(screen.queryByRole("button", { name: "New task" }), null);
  });
});

test("evidence tabs support keyboard arrows and keep tab focus through refresh", async (t) => {
  const { controller, user } = await setup(t);
  const result = screen.getByRole("tab", { name: "Result" });
  await user.click(result);
  await user.keyboard("{ArrowRight}");
  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("tab", { name: /Artifacts/ })
        .getAttribute("aria-selected"),
      "true",
    ),
  );
  await waitFor(() =>
    assert.ok(
      document.activeElement === screen.getByRole("tab", { name: /Artifacts/ }),
    ),
  );
  await act(() => controller.refresh());
  await waitFor(() =>
    assert.ok(
      document.activeElement === screen.getByRole("tab", { name: /Artifacts/ }),
    ),
  );
  await user.keyboard("{ArrowRight}");
  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("tab", { name: /Activity/ })
        .getAttribute("aria-selected"),
      "true",
    ),
  );
});

test("dialog focuses task, preserves the draft and field node during refresh, and restores trigger focus", async (t) => {
  const { controller, transport, user } = await setup(t);
  const trigger = screen.getByRole("button", { name: "New task" });
  await user.click(trigger);
  const field = await screen.findByLabelText("Task");
  await waitFor(() =>
    assert.ok(
      document.activeElement === field,
      "Task field should receive dialog focus",
    ),
  );
  await user.type(field, "Keep this draft");
  transport.projects = [
    ...transport.projects,
    { repository: "/repo/b", kind: "repository" },
  ];
  await act(() => controller.refresh());
  assert.ok(
    screen.getByLabelText("Task") === field,
    "Polling should retain the task field",
  );
  assert.equal((field as HTMLTextAreaElement).value, "Keep this draft");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => assert.ok(screen.queryByRole("dialog") === null));
  await waitFor(() =>
    assert.ok(
      document.activeElement === trigger,
      "Dialog should restore trigger focus",
    ),
  );
});

test("task form keeps fractional runtime defaults and rejects cost budgets for unsupported workers", async (t) => {
  const { transport, user } = await setup(t);
  await user.click(screen.getByRole("button", { name: "New task" }));
  await screen.findByRole("dialog");
  assert.equal(
    screen.getByRole("combobox", { name: "Project", exact: true }).textContent,
    "/repo/a",
  );
  assert.equal(
    (screen.getByLabelText("Runtime limit · minutes") as HTMLInputElement)
      .value,
    "0.5",
  );
  await user.type(screen.getByLabelText("Task"), "Investigate failing tests");
  await selectOption(user, "Worker", "codex · reviewer");
  await selectOption(user, "Cost limit", "Apply cost budget");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await screen.findByText(
    "This worker cannot enforce a cost budget. Choose No cost limit.",
  );
  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
  await selectOption(user, "Cost limit", "No cost limit");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );
  const call = transport.calls.find(
    (call) => call.name === "start_agent_task",
  )!;
  assert.deepEqual(call.args.budget, {
    max_runtime_minutes: 0.5,
    max_cost_usd: null,
  });
  assert.equal(call.args.conversation_id, null);
  assert.equal(call.args.provider, "codex");
});

test("changing projects clears revision and dependencies while retaining the task draft", async (t) => {
  const { user } = await setup(t, (transport) => {
    transport.projects.push({ repository: "/repo/b", kind: "repository" });
    transport.tasks.push(task("two", "/repo/b"));
  });
  await user.click(screen.getByRole("button", { name: "New task" }));
  await screen.findByRole("dialog");
  await selectOption(user, "Project", "/repo/a");
  await user.type(screen.getByLabelText("Task"), "Persistent task");
  await user.clear(screen.getByLabelText("Revision"));
  await user.type(screen.getByLabelText("Revision"), "edited-branch");
  await selectOption(
    user,
    "Wait for tasks (optional)",
    "Review authentication",
    true,
  );
  await selectOption(user, "Project", "/repo/b");
  assert.equal(
    (screen.getByLabelText("Revision") as HTMLInputElement).value,
    "HEAD",
  );
  assert.equal(
    (screen.getByLabelText("Task") as HTMLTextAreaElement).value,
    "Persistent task",
  );
  assert.match(
    screen.getByRole("combobox", { name: "Wait for tasks (optional)" })
      .textContent ?? "",
    /No dependencies/,
  );
  await selectOption(user, "Project", "/repo/a");
  assert.match(
    screen.getByRole("combobox", { name: "Wait for tasks (optional)" })
      .textContent ?? "",
    /No dependencies/,
  );
});

test("worker question accepts a custom answer with no preset selection", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      input: {
        questions: [
          { question: "Which approach?", options: [{ label: "Preset" }] },
        ],
      },
    };
  });
  await user.click(screen.getByRole("button", { name: "Review request" }));
  await screen.findByRole("dialog");
  await user.type(
    screen.getByLabelText("Or write your own answer"),
    "Custom approach",
  );
  await user.click(screen.getByRole("button", { name: "Send answer" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "submit_agent_input")
        .length,
      1,
    ),
  );
  assert.deepEqual(
    transport.calls.find((call) => call.name === "submit_agent_input")?.args,
    {
      task_id: "one",
      request_id: "request",
      approved: true,
      input: {
        questions: [
          { question: "Which approach?", options: [{ label: "Preset" }] },
        ],
        answers: { "Which approach?": "Custom approach" },
      },
    },
  );
});

test("permission review defaults to denial and submits that choice explicitly", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "permission",
      tool: "CodexExecution",
      input: { description: "Execute shell commands" },
    };
  });
  await user.click(screen.getByRole("button", { name: "Review request" }));
  await screen.findByRole("dialog");
  assert.equal(
    screen.getByRole("combobox", { name: "Decision" }).textContent,
    "Deny",
  );
  await user.click(screen.getByRole("button", { name: "Submit decision" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "submit_agent_input")
        .length,
      1,
    ),
  );
  assert.equal(
    transport.calls.find((call) => call.name === "submit_agent_input")?.args
      .approved,
    false,
  );
});

test("handoff sends only after explicit submit and uses the edited message", async (t) => {
  const { controller, transport, user } = await setup(t);
  await act(async () =>
    transport.events.host({
      canSend: true,
      canShare: false,
      canExpand: false,
      displayMode: "fullscreen",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Bring to Codex" }));
  await screen.findByRole("dialog");
  assert.deepEqual(transport.messages, []);
  await act(() => controller.refresh());
  assert.deepEqual(transport.messages, []);
  const field = screen.getByLabelText("Message");
  await user.clear(field);
  await user.type(field, "Edited handoff for this chat");
  await user.click(
    screen.getByRole("button", { name: "Send to conversation" }),
  );
  await waitFor(() =>
    assert.deepEqual(transport.messages, ["Edited handoff for this chat"]),
  );
});

test("task and result text render literally without HTML interpretation", async (t) => {
  const injection = '<img src=x onerror="window.injected=true">';
  const { user } = await setup(t, (transport) => {
    transport.tasks[0].task = injection;
    transport.tasks[0].result = {
      summary: "<script>window.injected=true</script>",
      findings: [injection],
      evidence: [],
      changes: [],
      tests: [],
      recommendations: [],
    };
  });
  assert.equal(
    screen.getByRole("heading", { level: 1 }).textContent,
    injection,
  );
  await user.click(screen.getByRole("tab", { name: "Result" }));
  assert.ok(screen.getByText("<script>window.injected=true</script>"));
  assert.ok(document.querySelector("img, script") === null);
  assert.equal((dom.window as any).injected, undefined);
});

test("refresh preserves disclosure and inspector scroll, while Back stays on the task list", async (t) => {
  const { controller, user } = await setup(t);
  const detail = screen.getByRole("region", { name: "Task inspector" });
  const disclosure = screen.getByRole("button", { name: "Task details" });
  const root = disclosure.closest(".task-details");
  await user.click(disclosure);
  assert.equal(disclosure.getAttribute("aria-expanded"), "true");
  detail.scrollTop = 160;
  await act(() => controller.refresh());
  assert.ok(
    screen.getByRole("button", { name: "Task details" }) === disclosure,
  );
  assert.ok(disclosure.closest(".task-details") === root);
  assert.equal(disclosure.getAttribute("aria-expanded"), "true");
  assert.equal(detail.scrollTop, 160);
  await user.click(screen.getByRole("button", { name: "← Tasks" }));
  await act(() => controller.refresh());
  assert.equal(controller.getSnapshot().selected, undefined);
  assert.ok(screen.queryByText("Task details") === null);
});

test("console delegation requires choosing a project even with a sole registered repository", async (t) => {
  const { transport, user } = await setup(t, undefined, { mode: "console" });
  await user.click(screen.getByRole("button", { name: "＋ Delegate" }));
  await screen.findByRole("dialog");
  assert.equal(
    screen.getByRole("combobox", { name: "Project", exact: true }).textContent,
    "Choose a project",
  );
  await user.type(screen.getByLabelText("Task"), "Explicit project choice");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
  await selectOption(user, "Project", "/repo/a");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );
});

test("narrow scoped panel Back keeps the task list visible across refresh", async (t) => {
  const { controller, user } = await setup(t, undefined, {
    wide: false,
    scoped: true,
  });
  assert.equal(document.body.dataset.selected, "true");
  await user.click(screen.getByRole("button", { name: "← Tasks" }));
  assert.equal(document.body.dataset.selected, "false");
  await act(() => controller.refresh());
  assert.equal(document.body.dataset.selected, "false");
  assert.equal(controller.getSnapshot().selected, undefined);
  assert.ok(screen.getByRole("complementary", { name: "Delegated tasks" }));
});

test("project picker uses accessible options, changes scope by keyboard, and preserves its trigger during refresh", async (t) => {
  const { controller, user } = await setup(t);
  const picker = screen.getByRole("combobox", { name: "Project scope" });
  await user.click(picker);
  const all = await screen.findByRole("option", { name: "All projects" });
  await waitFor(() =>
    assert.ok(
      document.activeElement === all,
      "All projects should receive opening focus",
    ),
  );
  await user.keyboard("{End}");
  await waitFor(() =>
    assert.ok(
      document.activeElement ===
        screen.getByRole("option", { name: "a", exact: true }),
      "Project option should receive focus",
    ),
  );
  await user.keyboard("{Enter}");
  await waitFor(() =>
    assert.equal(controller.getSnapshot().repository, "/repo/a"),
  );
  await waitFor(() =>
    assert.equal(picker.getAttribute("aria-expanded"), "false"),
  );
  assert.match(picker.textContent ?? "", /a/);
  await act(() => controller.refresh());
  assert.ok(
    screen.getByRole("combobox", { name: "Project scope" }) === picker,
    "Polling should retain the picker trigger",
  );
  await user.click(picker);
  await waitFor(() =>
    assert.ok(
      document.activeElement ===
        screen.getByRole("option", { name: "a", exact: true }),
      "Project option should receive focus",
    ),
  );
  await user.keyboard("{Home}");
  await waitFor(() =>
    assert.ok(
      document.activeElement ===
        screen.getByRole("option", { name: "All projects" }),
      "All projects should receive Home focus",
    ),
  );
  await user.keyboard("{Enter}");
  await waitFor(() =>
    assert.equal(controller.getSnapshot().repository, undefined),
  );
});

test("delegation selects support keyboard choice and Escape preserves the draft dialog", async (t) => {
  const { user, transport } = await setup(t);
  await user.click(screen.getByRole("button", { name: "New task" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(screen.getByLabelText("Task"), "Keyboard worker selection");
  const worker = screen.getByRole("combobox", { name: "Worker", exact: true });
  await user.click(worker);
  await waitFor(() =>
    assert.ok(
      document.activeElement ===
        screen.getByRole("option", { name: "claude · reviewer", exact: true }),
    ),
  );
  await user.keyboard("{End}");
  await waitFor(() =>
    assert.ok(
      document.activeElement ===
        screen.getByRole("option", { name: "codex · reviewer", exact: true }),
    ),
  );
  await user.keyboard("{Enter}");
  await waitFor(() =>
    assert.equal(worker.getAttribute("aria-expanded"), "false"),
  );
  assert.match(worker.textContent ?? "", /codex · reviewer/);
  await user.click(worker);
  await waitFor(() =>
    assert.ok(
      document.activeElement ===
        screen.getByRole("option", { name: "codex · reviewer", exact: true }),
    ),
  );
  await user.keyboard("{Escape}");
  await waitFor(() =>
    assert.equal(worker.getAttribute("aria-expanded"), "false"),
  );
  assert.ok(screen.getByRole("dialog") === dialog);
  assert.equal(
    (screen.getByLabelText("Task") as HTMLTextAreaElement).value,
    "Keyboard worker selection",
  );
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.find((call) => call.name === "start_agent_task")?.args
        .provider,
      "codex",
    ),
  );
});

test("dependency multiselect retains multiple choices until explicit submission", async (t) => {
  const { user, transport } = await setup(t, (transport) => {
    const second = task("two");
    second.task = "Review database";
    transport.tasks.push(second);
  });
  await user.click(screen.getByRole("button", { name: "New task" }));
  await screen.findByRole("dialog");
  await user.type(screen.getByLabelText("Task"), "Wait for both reviews");
  const dependencies = screen.getByRole("combobox", {
    name: "Wait for tasks (optional)",
  });
  await user.click(dependencies);
  await user.click(
    await screen.findByRole("option", { name: "Review authentication" }),
  );
  assert.equal(dependencies.getAttribute("aria-expanded"), "true");
  await user.click(screen.getByRole("option", { name: "Review database" }));
  await user.keyboard("{Escape}");
  await waitFor(() =>
    assert.equal(dependencies.getAttribute("aria-expanded"), "false"),
  );
  assert.ok(screen.getByRole("dialog"));
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await waitFor(() =>
    assert.deepEqual(
      transport.calls.find((call) => call.name === "start_agent_task")?.args
        .depends_on,
      ["one", "two"],
    ),
  );
});

test("approved parent project suggestions allow an unlisted nested repository path", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.projects.push({ repository: "/approved", kind: "parent" });
  });
  await user.click(screen.getByRole("button", { name: "New task" }));
  await screen.findByRole("dialog");
  const project = screen.getByRole("combobox", {
    name: "Project",
    exact: true,
  });
  await user.clear(project);
  await user.type(project, "/approved/new/nested-repo");
  await user.keyboard("{Escape}");
  assert.ok(screen.getByRole("dialog"));
  await user.type(screen.getByLabelText("Task"), "Review nested repository");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.find((call) => call.name === "start_agent_task")?.args
        .repository,
      "/approved/new/nested-repo",
    ),
  );
});

test("worker questions submit preset multiple answers and a custom override together", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      input: {
        questions: [
          {
            question: "Which checks?",
            multiSelect: true,
            options: [{ label: "Types" }, { label: "Tests" }],
          },
          { question: "Which scope?", options: [{ label: "Default scope" }] },
        ],
      },
    };
  });
  await user.click(screen.getByRole("button", { name: "Review request" }));
  await screen.findByRole("dialog");
  const checks = screen.getByRole("combobox", { name: "Which checks?" });
  await user.click(checks);
  await user.click(await screen.findByRole("option", { name: "Types" }));
  await user.click(screen.getByRole("option", { name: "Tests" }));
  await user.keyboard("{Escape}");
  await selectOption(user, "Which scope?", "Default scope");
  await user.type(
    screen.getAllByLabelText("Or write your own answer")[1],
    "Expanded scope",
  );
  await user.click(screen.getByRole("button", { name: "Send answer" }));
  await waitFor(() =>
    assert.deepEqual(
      (
        transport.calls.find((call) => call.name === "submit_agent_input")?.args
          .input as any
      )?.answers,
      {
        "Which checks?": "Types, Tests",
        "Which scope?": "Expanded scope",
      },
    ),
  );
});

test("zero runtime and cost budgets cannot launch a task", async (t) => {
  const { transport, user } = await setup(t);
  await user.click(screen.getByRole("button", { name: "New task" }));
  await screen.findByRole("dialog");
  await user.type(screen.getByLabelText("Task"), "Budget validation");
  const runtime = screen.getByLabelText("Runtime limit · minutes");
  await user.clear(runtime);
  await user.type(runtime, "0");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await screen.findByText(
    "Runtime limit must be greater than zero and at most 120 minutes.",
  );
  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
  await user.clear(runtime);
  await user.type(runtime, "1");
  await selectOption(user, "Cost limit", "Apply cost budget");
  const cost = screen.getByLabelText("Cost budget · USD");
  await user.clear(cost);
  await user.type(cost, "0");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
  await user.clear(cost);
  await user.type(cost, "0.01");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await waitFor(() =>
    assert.deepEqual(
      transport.calls.find((call) => call.name === "start_agent_task")?.args
        .budget,
      { max_runtime_minutes: 1, max_cost_usd: 0.01 },
    ),
  );
});

test("console worker picker routes and seeds the delegation worker", async (t) => {
  const { controller, user, transport } = await setup(t, undefined, {
    mode: "console",
  });
  await selectOption(user, "Worker", "codex · reviewer");
  await waitFor(() =>
    assert.equal(controller.getSnapshot().workerRoute, "codex.reviewer"),
  );
  await user.click(
    screen.getByRole("button", { name: "Delegate to this worker" }),
  );
  await screen.findByRole("dialog");
  assert.match(
    screen.getByRole("combobox", { name: "Worker", exact: true }).textContent ??
      "",
    /codex · reviewer/,
  );
  await selectOption(user, "Project", "/repo/a");
  await user.type(screen.getByLabelText("Task"), "Use selected worker");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.find((call) => call.name === "start_agent_task")?.args
        .provider,
      "codex",
    ),
  );
});

test("permission picker Escape preserves denial and keyboard approval submits the selected decision", async (t) => {
  const { user, transport } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "permission",
      tool: "CodexExecution",
      input: { description: "Execute shell commands" },
    };
  });
  await user.click(screen.getByRole("button", { name: "Review request" }));
  const dialog = await screen.findByRole("dialog");
  const decision = screen.getByRole("combobox", { name: "Decision" });
  await user.click(decision);
  await waitFor(() =>
    assert.ok(
      document.activeElement ===
        screen.getByRole("option", { name: "Deny", exact: true }),
    ),
  );
  await user.keyboard("{Escape}");
  await waitFor(() =>
    assert.equal(decision.getAttribute("aria-expanded"), "false"),
  );
  assert.ok(screen.getByRole("dialog") === dialog);
  assert.equal(decision.textContent, "Deny");
  await user.click(decision);
  await waitFor(() =>
    assert.ok(
      document.activeElement ===
        screen.getByRole("option", { name: "Deny", exact: true }),
    ),
  );
  await user.keyboard("{End}");
  await waitFor(() =>
    assert.ok(
      document.activeElement ===
        screen.getByRole("option", {
          name: "Approve this execution turn",
          exact: true,
        }),
    ),
  );
  await user.keyboard("{Enter}");
  await waitFor(() =>
    assert.equal(decision.getAttribute("aria-expanded"), "false"),
  );
  assert.equal(decision.textContent, "Approve this execution turn");
  await user.click(screen.getByRole("button", { name: "Submit decision" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.find((call) => call.name === "submit_agent_input")?.args
        .approved,
      true,
    ),
  );
});

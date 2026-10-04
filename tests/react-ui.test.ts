// @vitest-environment jsdom
import assert from "node:assert/strict";
import { describe, test, vi, type TestContext } from "vitest";
import type {
  HostState,
  Task,
  Transport,
  TransportEvents,
} from "../ui/core/types";

// UI primitives read browser capabilities at module initialization.
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});
import { createElement } from "react";
import {
  act,
  render,
  screen,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Controller } from "../ui/core/controller";
import { ControllerContext } from "../ui/components/controller-context";
import { AppShell } from "../ui/shells/app-shell";

// assert.equal(element, null) diffs the whole jsdom object graph on failure,
// which never finishes and starves waitFor's timeout.
function assertAbsent(element: Element | null) {
  assert.ok(
    element === null,
    `Unexpected element: ${element?.outerHTML.slice(0, 200)}`,
  );
}

function task(id = "one", repository = "/repo/a"): Task {
  return {
    id,
    repository,
    revision: "feature",
    provider: "claude",
    worker_profile: "reviewer",
    title: "Review authentication",
    description: "Review authentication and report relevant findings.",
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

function configureProjectRegistration(
  transport: FakeTransport,
  options: {
    picked?: string | null;
    browseError?: string;
    registerError?: string;
    canonicalRepository?: string;
  } = {},
) {
  const original = transport.tool.bind(transport);
  transport.tool = async <T>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> => {
    if (name === "browse_user_agent_project") {
      transport.calls.push({ name, args });
      if (options.browseError) throw new Error(options.browseError);
      return { repository: options.picked ?? null } as T;
    }
    if (name === "register_user_agent_project") {
      transport.calls.push({ name, args });
      if (options.registerError) throw new Error(options.registerError);
      const project = {
        repository: options.canonicalRepository ?? String(args.repository),
        kind: "repository",
      };
      transport.projects.push(project);
      return project as T;
    }
    return original<T>(name, args);
  };
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
  t.onTestFinished(() => {
    cleanup();
    controller.dispose();
  });
  const user = userEvent.setup({ document: document });
  return { controller, transport, user };
}

async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
  multiple = false,
) {
  const trigger = screen.getByRole("combobox", { name: label });
  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: option }));
  if (multiple) await user.keyboard("{Escape}");
  await waitFor(() =>
    assert.equal(trigger.getAttribute("aria-expanded"), "false"),
  );
}

async function enterTask(user: any, description: string) {
  await user.type(screen.getByLabelText("Description"), description);
}

function configureModelDefaults(
  transport: FakeTransport,
  defaults: Record<string, string>,
  models?: {
    value: string;
    displayName: string;
    description: string;
    supportsEffort?: boolean;
    supportedEffortLevels?: string[];
  }[],
) {
  const original = transport.tool.bind(transport);
  transport.tool = async <T>(name: string, args = {}) => {
    const result = await original<any>(name, args);
    if (name === "get_agent_settings")
      return { ...result, values: { ...result.values, ...defaults } } as T;
    if (name === "list_available_workers")
      return result.map((worker: any) => ({
        ...worker,
        profiles: ["reviewer", "researcher"],
        ...(models ? { models } : {}),
      })) as T;
    return result as T;
  };
}

test("settings dialog renders host schema groups and saves only changed fields", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    const original = transport.tool.bind(transport);
    transport.tool = async <T>(name: string, args = {}) => {
      if (name === "update_agent_settings") {
        transport.calls.push({ name, args });
        return { values: {} } as T;
      }
      const result = await original<any>(name, args);
      return (
        name === "get_agent_settings"
          ? {
              values: {
                ...result.values,
                use_cost_budget: false,
                max_cost_usd: 5,
                default_model: "",
              },
              schema: {
                type: "object",
                properties: {
                  max_runtime_minutes: {
                    type: "number",
                    title: "Runtime minutes",
                    minimum: 0.01,
                  },
                  use_cost_budget: { type: "boolean", title: "Use cost limit" },
                  max_cost_usd: { type: "number", title: "Cost USD" },
                  default_model: {
                    type: "string",
                    title: "Model",
                    enum: ["", "model-a"],
                  },
                },
              },
              layout: [
                {
                  kind: "group",
                  title: "Budgets",
                  items: [
                    { kind: "property", property: "max_runtime_minutes" },
                    { kind: "property", property: "use_cost_budget" },
                    { kind: "tool", tool: "open", title: "Open" },
                  ],
                },
              ],
            }
          : result
      ) as T;
    };
  });
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("dialog");
  assert.ok(screen.getByRole("button", { name: "Close" }));
  assert.ok(screen.getByRole("button", { name: /^Budgets/ }));
  assertAbsent(screen.queryByRole("button", { name: "Open" }));
  const save = screen.getByRole("button", { name: "Save settings" });
  assert.equal((save as HTMLButtonElement).disabled, true);
  await selectOption(user, "Use cost limit", "On");
  await user.click(screen.getByRole("button", { name: /^Other settings/ }));
  await selectOption(user, "Model", "model-a");
  // One edit in each group.
  assert.equal(
    screen.getAllByText("1 changed", { selector: ".settings-group-badge" })
      .length,
    2,
  );
  await user.click(screen.getByRole("button", { name: "Save 2 changes" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));
  assert.deepEqual(
    transport.calls.find((call) => call.name === "update_agent_settings")!.args,
    { set: { use_cost_budget: true, default_model: "model-a" } },
  );
});

test("settings dialog labels discovered models and summarizes collapsed groups", async (t) => {
  const { user } = await setup(t, (transport) => {
    const original = transport.tool.bind(transport);
    transport.tool = async <T>(name: string, args = {}) => {
      const result = await original<any>(name, args);
      if (name === "list_available_workers")
        return result.map((worker: any) => ({
          ...worker,
          models: [
            {
              value: "model-a",
              displayName: "Model A",
              description: "Fast model",
            },
          ],
        })) as T;
      if (name === "get_agent_settings")
        return {
          values: {
            ...result.values,
            max_runtime_minutes: 20,
            default_model: "model-a",
            default_reasoning_effort: "default",
          },
          schema: {
            type: "object",
            properties: {
              max_runtime_minutes: { type: "number", title: "Runtime" },
              default_model: {
                type: "string",
                title: "Default model",
                enum: ["", "model-a"],
              },
              default_reasoning_effort: {
                type: "string",
                title: "Reasoning effort",
                enum: ["default", "high"],
              },
            },
          },
          layout: [
            {
              kind: "group",
              title: "Budgets",
              items: [{ kind: "property", property: "max_runtime_minutes" }],
            },
            {
              kind: "group",
              title: "Models",
              items: [
                { kind: "property", property: "default_model" },
                { kind: "property", property: "default_reasoning_effort" },
              ],
            },
          ],
        } as T;
      return result as T;
    };
  });
  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("dialog");
  // Collapsed groups summarize current values with display names and Inherit.
  const models = screen.getByRole("button", { name: /^Models/ });
  assert.equal(models.getAttribute("aria-expanded"), "false");
  assert.equal(
    models.querySelector(".settings-group-summary")?.textContent,
    "Model A · Inherit",
  );
  await user.click(models);
  const trigger = screen.getByRole("combobox", {
    name: "Default model",
  });
  assert.equal(trigger.textContent, "Model A");
  await user.click(trigger);
  // Menu options show the description as secondary text.
  const option = await screen.findByRole("option", { name: /Model A/ });
  assert.equal(
    option.querySelector(".select-item-description")?.textContent,
    "Fast model",
  );
  assert.ok(await screen.findByRole("option", { name: "Inherit" }));
  await user.keyboard("{Escape}");
});

test("discovered model metadata offers suggestions and rejects unsupported inherited effort until corrected", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureModelDefaults(
      transport,
      {
        default_model: "limited-model",
        default_reasoning_effort: "high",
      },
      [
        {
          value: "limited-model",
          displayName: "Limited model",
          description: "SDK model",
          supportedEffortLevels: ["low"],
        },
      ],
    ),
  );
  await user.click(screen.getByRole("button", { name: "New task" }));
  await screen.findByRole("dialog");
  const model = screen.getByLabelText("Model") as HTMLInputElement;
  assert.equal(model.placeholder, "limited-model");
  await user.click(model);
  const suggestion = await screen.findByRole("option", {
    name: /Limited model/,
  });
  assert.match(suggestion.textContent ?? "", /limited-model/);
  assert.match(suggestion.textContent ?? "", /SDK model/);
  await user.keyboard("{Escape}");
  await enterTask(user, "Check discovered metadata");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await screen.findByText(
    /Choose a reasoning effort supported by claude model limited-model: low/,
  );
  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
  await selectOption(user, "Reasoning effort", "low");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );
  assert.equal(
    transport.calls.find((call) => call.name === "start_agent_task")!.args
      .reasoning_effort,
    "low",
  );
});

test("runtime default model metadata blocks unsupported effort and permits native default reasoning", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureModelDefaults(transport, {}, [
      {
        value: "default",
        displayName: "Runtime default",
        description: "",
        supportsEffort: false,
      },
    ]),
  );
  await user.click(screen.getByRole("button", { name: "New task" }));
  await screen.findByRole("dialog");
  await enterTask(user, "Check native default metadata");
  assert.equal((screen.getByLabelText("Model") as HTMLInputElement).value, "");
  await selectOption(user, "Reasoning effort", "high (unsupported by claude)");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await screen.findByText(
    /Choose a reasoning effort supported by claude model default/,
  );
  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
  await selectOption(
    user,
    "Reasoning effort",
    "Use default (provider runtime)",
  );
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
  assert.equal(call.args.model, "");
  assert.equal(call.args.reasoning_effort, "default");
});

test("unknown model metadata keeps generic reasoning choices and accepts custom model IDs", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureModelDefaults(transport, {}, [
      {
        value: "no-effort",
        displayName: "No effort",
        description: "",
        supportsEffort: false,
      },
    ]),
  );
  await user.click(screen.getByRole("button", { name: "New task" }));
  await screen.findByRole("dialog");
  await enterTask(user, "Use custom model ID");
  await user.type(screen.getByLabelText("Model"), "custom-model");
  assert.ok(screen.getByText(/Reasoning support for this model is unknown/));
  await selectOption(user, "Reasoning effort", "high");
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
  assert.equal(call.args.model, "custom-model");
  assert.equal(call.args.reasoning_effort, "high");
});

test("model selection retains unsupported Codex effort on Claude and blocks submission until corrected", async (t) => {
  const { transport, user } = await setup(t);
  await user.click(screen.getByRole("button", { name: "New task" }));
  await screen.findByRole("dialog");
  await enterTask(user, "Investigate effort selection");
  await selectOption(user, "Worker", "codex · reviewer");
  await selectOption(user, "Reasoning effort", "none");
  await selectOption(user, "Worker", "claude · reviewer");
  assert.match(
    screen.getByRole("combobox", { name: "Reasoning effort" }).textContent ??
      "",
    /none \(unsupported by claude\)/,
  );
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await screen.findByText(/Choose a reasoning effort supported by claude/);
  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
  await selectOption(user, "Reasoning effort", "high");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );
  assert.equal(
    transport.calls.find((call) => call.name === "start_agent_task")!.args
      .reasoning_effort,
    "high",
  );
});

test("model selection rejects unsupported inherited Claude effort and accepts an explicit supported override", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureModelDefaults(transport, { default_reasoning_effort: "none" }),
  );
  await user.click(screen.getByRole("button", { name: "New task" }));
  await screen.findByRole("dialog");
  await enterTask(user, "Investigate inherited effort");
  assert.match(
    screen.getByRole("combobox", { name: "Reasoning effort" }).textContent ??
      "",
    /Use default \(none\)/,
  );
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await screen.findByText(/Choose a reasoning effort supported by claude/);
  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
  await selectOption(user, "Reasoning effort", "medium");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );
  assert.equal(
    transport.calls.find((call) => call.name === "start_agent_task")!.args
      .reasoning_effort,
    "medium",
  );
});

test("model selection updates role and provider defaults while preserving explicit drafts", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureModelDefaults(transport, {
      default_model: "global-model",
      default_reasoning_effort: "low",
      claude_default_model: "claude-model",
      claude_default_reasoning_effort: "medium",
      reviewer_default_model: "review-model",
      reviewer_default_reasoning_effort: "max",
    }),
  );
  await user.click(screen.getByRole("button", { name: "New task" }));
  await screen.findByRole("dialog");
  const field = screen.getByLabelText("Model") as HTMLInputElement;
  assert.equal(field.placeholder, "review-model");
  assert.match(
    screen.getByRole("combobox", { name: "Reasoning effort" }).textContent ??
      "",
    /Use default \(max\)/,
  );
  await user.type(field, "explicit-model");
  await selectOption(user, "Worker", "claude · researcher");
  assert.equal(field.placeholder, "claude-model");
  assert.equal(field.value, "explicit-model");
  assert.match(
    screen.getByRole("combobox", { name: "Reasoning effort" }).textContent ??
      "",
    /Use default \(medium\)/,
  );
  await selectOption(user, "Worker", "codex · researcher");
  assert.equal(field.placeholder, "global-model");
  assert.match(
    screen.getByRole("combobox", { name: "Reasoning effort" }).textContent ??
      "",
    /Use default \(low\)/,
  );
  await selectOption(user, "Reasoning effort", "high");
  await selectOption(user, "Worker", "claude · reviewer");
  assert.equal(field.placeholder, "review-model");
  assert.equal(field.value, "explicit-model");
  assert.equal(
    screen.getByRole("combobox", { name: "Reasoning effort" }).textContent,
    "high",
  );
  await enterTask(user, "Preserve explicit selections");
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
  assert.equal(call.args.model, "explicit-model");
  assert.equal(call.args.reasoning_effort, "high");
});

test("description toggles literally, survives refresh, and resets for another task", async (t) => {
  const literal =
    '<img src=x onerror="window.injected=true">\nFull worker instructions.';
  const { controller, transport, user } = await setup(t, (transport) => {
    transport.tasks[0].description = literal;
    transport.tasks.push({
      ...task("two"),
      title: "Second task",
      description: "Second instructions",
    });
  });
  const toggle = screen.getByRole("button", {
    name: "Description",
  });
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await user.click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const panel = toggle
    .closest(".task-description")!
    .querySelector(".task-description-content")!;
  assert.equal(panel.textContent, literal);
  assertAbsent(panel.querySelector("img"));
  transport.tasks[0] = {
    ...transport.tasks[0],
    description: literal + " Updated.",
  };
  await act(() => controller.refresh());
  assert.ok(
    screen.getByRole("button", { name: "Description" }) === toggle,
    "Refresh retains the description toggle node",
  );
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(panel.textContent, literal + " Updated.");
  await user.click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await user.click(toggle);
  await act(() => controller.select("two"));
  const next = screen.getByRole("button", { name: "Description" });
  assert.equal(next.getAttribute("aria-expanded"), "false");
  await user.click(next);
  assert.ok(screen.getByText("Second instructions"));
});

for (const action of ["interrupt", "cancel", "retry"] as const) {
  test(`${action} confirmation defaults the task description ${action === "retry" ? "closed" : "open"}`, async (t) => {
    const { controller, transport, user } = await setup(t);
    await act(() =>
      controller.open({ kind: "control", action, task: transport.tasks[0] }),
    );
    const dialog = await screen.findByRole("dialog");
    const toggle = within(dialog).getByRole("button", { name: "Description" });
    const expanded = action !== "retry";
    assert.equal(toggle.getAttribute("aria-expanded"), String(expanded));
    if (expanded) {
      assert.equal(
        dialog.querySelector(".task-description-content")?.textContent,
        transport.tasks[0].description,
      );
    }
    await user.click(toggle);
    assert.equal(toggle.getAttribute("aria-expanded"), String(!expanded));
    assert.equal(
      transport.calls.some((call) => call.name === `${action}_agent_task`),
      false,
      "Inspecting the description does not submit the task action",
    );
  });
}

test("delegation submits the full request without a title and search matches description", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) => {
    transport.tasks[0].description = "Inspect the unique zebra boundary.";
    transport.tasks.push({
      ...task("two"),
      title: "Other task",
      description: "Unrelated instructions",
    });
  });
  await user.type(
    screen.getByRole("searchbox", { name: "Search tasks" }),
    "ZEBRA",
  );
  assert.ok(screen.getByRole("button", { name: /^Review authentication/ }));
  assertAbsent(screen.queryByRole("button", { name: /^Other task/ }));
  await act(() => controller.setSearch(""));
  await user.click(screen.getByRole("button", { name: "New task" }));
  assertAbsent(screen.queryByLabelText("Task title"));
  const request =
    "Review authentication.\nInclude all edge cases and report the evidence.";
  await enterTask(user, request);
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );
  const submitted = transport.calls.find(
    (call) => call.name === "start_agent_task",
  )!.args;
  assert.ok(!("title" in submitted));
  assert.equal(submitted.description, request);
  assert.ok(!("task" in submitted));
});

test("inline preview expands and collapses while preserving the selected task", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) => {
      const second = task("two");
      second.title = "Review database";
      transport.tasks.push(second);
    },
    { displayMode: "inline" },
  );
  await act(() => controller.select("two"));
  assert.ok(screen.getByText("Review database"));
  assert.ok(screen.getByText("Running", { exact: true }));
  assertAbsent(screen.queryByRole("button", { name: "New task" }));
  assertAbsent(screen.queryByRole("region", { name: "Task inspector" }));
  assertAbsent(
    screen.queryByRole("complementary", { name: "Delegated tasks" }),
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
  assertAbsent(screen.queryByRole("region", { name: "Task inspector" }));
});

test("the header menu offers the secondary actions and runs them", async (t) => {
  const { transport, user } = await setup(t);
  await user.click(screen.getByRole("button", { name: "More actions" }));
  assert.deepEqual(
    (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
    ["Refresh", "Collapse", "Add project", "Settings"],
  );
  await user.click(screen.getByRole("menuitem", { name: "Settings" }));
  await waitFor(() =>
    assert.ok(
      transport.calls.some((call) => call.name === "get_agent_settings"),
    ),
  );
});

test("a thread panel leaves Add project to global launches", async (t) => {
  const { controller, user } = await setup(t);
  await act(() =>
    controller.applyScope({ panel_scope: { conversation_id: "thread" } }),
  );
  assertAbsent(screen.queryByRole("button", { name: "Add project" }));
  await user.click(screen.getByRole("button", { name: "More actions" }));
  assert.deepEqual(
    (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
    ["Refresh", "Collapse", "Settings"],
  );
});

test("inline host without expansion offers the chat controls fallback", async (t) => {
  await setup(
    t,
    (transport) => {
      transport.host.canExpand = false;
    },
    { displayMode: "inline" },
  );
  assertAbsent(screen.queryByRole("button", { name: "Open panel" }));
  assert.ok(screen.getByText("Expand this app using the chat controls."));
  assertAbsent(screen.queryByRole("button", { name: "New task" }));
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
  assertAbsent(screen.queryByRole("region", { name: "Task inspector" }));
});

test("host collapse preserves a delegation draft until scope changes", async (t) => {
  const { controller, transport, user } = await setup(t);
  await user.click(screen.getByRole("button", { name: "New task" }));
  const field = await screen.findByLabelText("Description");
  await user.type(field, "Preserve this suspended draft");
  const dialogState = controller.getSnapshot().dialog;
  await act(() => transport.expand());
  assert.ok(screen.getByRole("region", { name: "Delegated work preview" }));
  assertAbsent(screen.queryByRole("dialog"));
  assert.ok(controller.getSnapshot().dialog === dialogState);
  await user.click(screen.getByRole("button", { name: "Open panel" }));
  await screen.findByRole("dialog");
  assert.ok(
    screen.getByLabelText("Description") === field,
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
  assertAbsent(screen.queryByRole("dialog"));
  await act(() => controller.changeProject("/repo/b"));
  assert.equal(controller.getSnapshot().dialog, undefined);
  await user.click(screen.getByRole("button", { name: "Open panel" }));
  assertAbsent(screen.queryByRole("dialog"));
  await user.click(screen.getAllByRole("button", { name: "New task" })[0]);
  await screen.findByRole("dialog");
  assert.equal(
    (screen.getByLabelText("Description") as HTMLTextAreaElement).value,
    "",
  );
  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
});

describe("console and nonembedded panels retain the full interface in inline mode", () => {
  test("console", async (t) => {
    await setup(t, undefined, { mode: "console", displayMode: "inline" });
    assert.ok(screen.getByRole("button", { name: "＋ Delegate" }));
    assert.ok(screen.getByRole("region", { name: "Task inspector" }));
    assertAbsent(screen.queryByRole("button", { name: "Open panel" }));
  });
  test("nonembedded panel", async (t) => {
    await setup(
      t,
      (transport) => {
        transport.embedded = false;
      },
      { displayMode: "inline" },
    );
    assert.ok(screen.getByRole("button", { name: "New task" }));
    assert.ok(screen.getByRole("region", { name: "Task inspector" }));
    assertAbsent(screen.queryByRole("button", { name: "Open panel" }));
  });
});

test("inline preview renders refresh errors without exposing the full interface", async (t) => {
  const { controller } = await setup(t, undefined, { displayMode: "inline" });
  await act(() => controller.report(new Error("Refresh unavailable")));
  assert.equal(screen.getByRole("alert").textContent, "Refresh unavailable");
  assert.ok(screen.getByText("Review authentication"));
  assert.ok(screen.getByRole("button", { name: "Open panel" }));
  assertAbsent(screen.queryByRole("region", { name: "Task inspector" }));
});

test("inline preview summarizes repository scope independently of list filters", async (t) => {
  const { controller } = await setup(
    t,
    (transport) => {
      const waiting = task("waiting");
      waiting.title = "Waiting review";
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
  assertAbsent(screen.queryByRole("region", { name: "Task inspector" }));
});

describe("inline preview distinguishes empty tasks from connecting state", () => {
  test("empty", async (t) => {
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
  test("connecting", async (t) => {
    await setup(t, undefined, { start: false });
    assert.ok(screen.getByRole("region", { name: "Delegated work preview" }));
    assert.equal(screen.getByRole("status").textContent, "Connecting…");
    assertAbsent(screen.queryByText("No delegated tasks yet."));
    assertAbsent(screen.queryByRole("button", { name: "New task" }));
  });
});

test("a panel opened outside a host points developers at the dev host", async (t) => {
  // Opened directly in a browser: not embedded, so the full layout shows.
  const { controller } = await setup(
    t,
    (transport) => {
      transport.embedded = false;
    },
    { start: false },
  );
  await act(() => controller.showHostRequired());
  assert.ok(
    screen.getByText(
      "Ask Codex to call open_codex_subagent_extension. To preview the panel during development, run npm run dev:ui.",
    ),
  );
});

test("task filters keep exactly one filter selected", async (t) => {
  const { user } = await setup(t);
  const pressed = (name: string) =>
    screen.getByRole("button", { name }).getAttribute("aria-pressed");
  assert.equal(pressed("All"), "true");
  await user.click(screen.getByRole("button", { name: "Done" }));
  assert.equal(pressed("Done"), "true");
  assert.equal(pressed("All"), "false");
  // Clicking the selected filter must not leave the list with no filter.
  await user.click(screen.getByRole("button", { name: "Done" }));
  assert.equal(pressed("Done"), "true");
});

test("selecting a tab scrolls it into view in an overflowing tab list", async (t) => {
  const { user } = await setup(t);
  const list = screen.getByRole("tablist");
  const scrollTo = vi.fn();
  // jsdom has no layout, so describe a 100px list whose Details tab sits past its edge.
  const define = (element: HTMLElement, values: Record<string, unknown>) =>
    Object.entries(values).forEach(([key, value]) =>
      Object.defineProperty(element, key, { configurable: true, value }),
    );
  define(list, { clientWidth: 100, scrollLeft: 0, scrollTo });
  define(screen.getByRole("tab", { name: "Details" }), {
    offsetLeft: 150,
    offsetWidth: 60,
  });
  define(screen.getByRole("tab", { name: "Result" }), {
    offsetLeft: 0,
    offsetWidth: 60,
  });
  await user.click(screen.getByRole("tab", { name: "Details" }));
  // Right edge (210) plus the 12px gap, less the visible width.
  await waitFor(() => assert.equal(scrollTo.mock.calls.at(-1)?.[0].left, 122));
  // A tab already fully inside the list leaves it where it is.
  scrollTo.mockClear();
  define(list, { scrollLeft: 0 });
  define(screen.getByRole("tab", { name: /^Artifacts/ }), {
    offsetLeft: 20,
    offsetWidth: 40,
  });
  await user.click(screen.getByRole("tab", { name: /^Artifacts/ }));
  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("tab", { name: /^Artifacts/ })
        .getAttribute("aria-selected"),
      "true",
    ),
  );
  assert.equal(scrollTo.mock.calls.length, 0);
});

test("evidence tabs support keyboard arrows and keep tab focus through refresh", async (t) => {
  const { controller, user } = await setup(t);
  const result = screen.getByRole("tab", { name: "Result" });
  // Count badges stay separate words for assistive technology.
  assert.ok(screen.getByRole("tab", { name: /^Artifacts \d+$/ }));
  assert.ok(screen.getByRole("tab", { name: /^Activity \d+$/ }));
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
  await user.keyboard("{ArrowRight}");
  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("tab", { name: "Details" })
        .getAttribute("aria-selected"),
      "true",
    ),
  );
  assert.ok(screen.getByText("Task ID"));
});

test("dialog focuses task, preserves the draft and field node during refresh, and restores trigger focus", async (t) => {
  const { controller, transport, user } = await setup(t);
  const trigger = screen.getByRole("button", { name: "New task" });
  await user.click(trigger);
  const field = await screen.findByLabelText("Description");
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
    screen.getByLabelText("Description") === field,
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
    screen.getByRole("combobox", { name: "Project" }).textContent,
    "/repo/a",
  );
  assert.equal(
    (screen.getByLabelText("Runtime limit · minutes") as HTMLInputElement)
      .value,
    "0.5",
  );
  await enterTask(user, "Investigate failing tests");
  await selectOption(user, "Worker", "codex · reviewer");
  await user.type(screen.getByLabelText("Model"), "selected-model");
  await selectOption(user, "Reasoning effort", "high");
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
  assert.equal(call.args.model, "selected-model");
  assert.equal(call.args.reasoning_effort, "high");
});

test("changing projects clears revision and dependencies while retaining the task draft", async (t) => {
  const { user } = await setup(t, (transport) => {
    transport.projects.push({ repository: "/repo/b", kind: "repository" });
    transport.tasks.push(task("two", "/repo/b"));
  });
  await user.click(screen.getByRole("button", { name: "New task" }));
  await screen.findByRole("dialog");
  await selectOption(user, "Project", "/repo/a");
  await enterTask(user, "Persistent task");
  await selectOption(user, "Workspace", "Isolated worktree");
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
    (screen.getByLabelText("Description") as HTMLTextAreaElement).value,
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

test("permission review makes no decision until the user clicks Deny", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "permission",
      tool: "CodexExecution",
      input: { description: "Execute shell commands" },
    };
  });
  await user.click(screen.getByRole("button", { name: "Review request" }));
  await screen.findByRole("dialog");
  assert.equal(screen.queryByRole("combobox", { name: "Decision" }), null);
  assert.equal(
    transport.calls.filter((call) => call.name === "submit_agent_input").length,
    0,
  );
  await user.click(screen.getByRole("button", { name: "Deny" }));
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
    transport.tasks[0].title = injection;
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
  assert.equal((window as any).injected, undefined);
});

test("the header trails a running task's live activity and drops it once settled", async (t) => {
  let events: unknown[] = [];
  const { controller, transport } = await setup(t, (transport) => {
    const original = transport.tool.bind(transport);
    transport.tool = async <T>(name: string, args = {}) =>
      (name === "get_agent_events" ? events : original(name, args)) as T;
  });
  const live = () => document.querySelector(".eyebrow-live");
  const eyebrow = () => document.querySelector(".eyebrow");
  assert.equal(live()?.textContent, "", "No detail before events load");
  assert.equal(eyebrow()?.hasAttribute("data-live"), false);
  events = [
    {
      id: 1,
      task_id: "one",
      timestamp: "2026-10-03T12:00:00.000Z",
      type: "task.started",
      data: {},
    },
  ];
  await act(() => controller.refresh());
  assert.equal(live()?.textContent, "· Working");
  assert.equal(eyebrow()?.hasAttribute("data-live"), true);
  assert.ok(
    live()?.matches(".eyebrow > :last-child"),
    "Changing detail never shifts the labels before it",
  );
  assert.ok(document.querySelector(".eyebrow .row-status-icon.running"));
  transport.tasks = [{ ...task(), status: "completed" }];
  await act(() => controller.refresh());
  assert.equal(live()?.textContent, "");
  assertAbsent(document.querySelector(".eyebrow .row-status-icon.running"));
  assert.ok(document.querySelector(".eyebrow .row-status-icon.completed"));
});

test("long notices clamp behind Show more and expand on demand", async (t) => {
  // jsdom has no layout, so report clamped notice text as overflowing.
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.matches(".callout-text:not([data-open])") ? 80 : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.matches(".callout-text") ? 36 : 0;
    },
  );
  const { user } = await setup(t, (transport) => {
    transport.tasks[0].error = "Worker stopped unexpectedly. ".repeat(20);
  });
  const more = screen.getByRole("button", { name: "Show more" });
  assert.equal(more.getAttribute("aria-expanded"), "false");
  await user.click(more);
  const less = screen.getByRole("button", { name: "Show less" });
  assert.equal(less.getAttribute("aria-expanded"), "true");
  assert.ok(document.querySelector(".callout-text[data-open]"));
  await user.click(less);
  assert.ok(screen.getByRole("button", { name: "Show more" }));
  assertAbsent(document.querySelector(".callout-text[data-open]"));
});

test("the inspector stacks when its fixed header would squeeze the evidence", async (t) => {
  t.onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  const notify: (() => void)[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  let height = 600;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.id === "detail" ? height : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.matches(".task-header") ? 300 : 0;
    },
  );
  await setup(t);
  const detail = screen.getByRole("region", { name: "Task inspector" });
  assert.equal(detail.hasAttribute("data-stacked"), false, "300px is enough");
  height = 560;
  act(() => notify.forEach((callback) => callback()));
  assert.equal(detail.hasAttribute("data-stacked"), true, "260px is not");
});

test("refresh preserves disclosure and inspector scroll, while Back stays on the task list", async (t) => {
  const { controller, user } = await setup(t);
  const detail = screen.getByRole("region", { name: "Task inspector" });
  const disclosure = screen.getByRole("button", { name: "Description" });
  const root = disclosure.closest(".task-description");
  await user.click(disclosure);
  assert.equal(disclosure.getAttribute("aria-expanded"), "true");
  detail.scrollTop = 160;
  await act(() => controller.refresh());
  assert.ok(screen.getByRole("button", { name: "Description" }) === disclosure);
  assert.ok(disclosure.closest(".task-description") === root);
  assert.equal(disclosure.getAttribute("aria-expanded"), "true");
  assert.equal(detail.scrollTop, 160);
  await user.click(screen.getByRole("button", { name: "← Tasks" }));
  await act(() => controller.refresh());
  assert.equal(controller.getSnapshot().selected, undefined);
  assert.ok(screen.queryByRole("button", { name: "Description" }) === null);
});

test("console delegation requires choosing a project even with a sole registered repository", async (t) => {
  const { transport, user } = await setup(t, undefined, { mode: "console" });
  await user.click(screen.getByRole("button", { name: "＋ Delegate" }));
  await screen.findByRole("dialog");
  assert.equal(
    screen.getByRole("combobox", { name: "Project" }).textContent,
    "Choose a project",
  );
  await enterTask(user, "Explicit project choice");
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
      document.activeElement === screen.getByRole("option", { name: "a" }),
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
      document.activeElement === screen.getByRole("option", { name: "a" }),
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
  await enterTask(user, "Keyboard worker selection");
  const worker = screen.getByRole("combobox", { name: "Worker" });
  await user.click(worker);
  await waitFor(() =>
    assert.ok(
      document.activeElement ===
        screen.getByRole("option", { name: "claude · reviewer" }),
    ),
  );
  await user.keyboard("{End}");
  await waitFor(() =>
    assert.ok(
      document.activeElement ===
        screen.getByRole("option", { name: "codex · reviewer" }),
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
        screen.getByRole("option", { name: "codex · reviewer" }),
    ),
  );
  await user.keyboard("{Escape}");
  await waitFor(() =>
    assert.equal(worker.getAttribute("aria-expanded"), "false"),
  );
  assert.ok(screen.getByRole("dialog") === dialog);
  assert.equal(
    (screen.getByLabelText("Description") as HTMLTextAreaElement).value,
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
    second.title = "Review database";
    transport.tasks.push(second);
  });
  await user.click(screen.getByRole("button", { name: "New task" }));
  await screen.findByRole("dialog");
  await enterTask(user, "Wait for both reviews");
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
  });
  await user.clear(project);
  await user.type(project, "/approved/new/nested-repo");
  await user.keyboard("{Escape}");
  assert.ok(screen.getByRole("dialog"));
  await enterTask(user, "Review nested repository");
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
  await enterTask(user, "Budget validation");
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
    screen.getByRole("combobox", { name: "Worker" }).textContent ?? "",
    /codex · reviewer/,
  );
  await selectOption(user, "Project", "/repo/a");
  await enterTask(user, "Use selected worker");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.find((call) => call.name === "start_agent_task")?.args
        .provider,
      "codex",
    ),
  );
});

test("permission buttons allow explicit approval without a dropdown", async (t) => {
  const { user, transport } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "permission",
      tool: "CodexExecution",
      input: { description: "Execute shell commands" },
    };
  });
  await user.click(screen.getByRole("button", { name: "Review request" }));
  await screen.findByRole("dialog");
  assert.equal(screen.queryByRole("combobox", { name: "Decision" }), null);
  await user.click(
    screen.getByRole("button", { name: "Approve this execution turn" }),
  );
  await waitFor(() =>
    assert.equal(
      transport.calls.find((call) => call.name === "submit_agent_input")?.args
        .approved,
      true,
    ),
  );
});

test("current repository selection locks revision to HEAD and submits the checkout strategy", async (t) => {
  const { transport, user } = await setup(t);
  await user.click(screen.getByRole("button", { name: "New task" }));
  await screen.findByRole("dialog");
  const revision = screen.getByLabelText("Revision") as HTMLInputElement;
  assert.equal(revision.value, "HEAD");
  assert.equal(revision.readOnly, true);
  assert.match(
    screen.getByRole("combobox", { name: "Workspace" }).textContent ?? "",
    /Current repository/,
  );
  await selectOption(user, "Workspace", "Isolated worktree");
  assert.equal(revision.readOnly, false);
  await user.clear(revision);
  await user.type(revision, "feature-branch");
  await enterTask(user, "Review my uncommitted edits");
  await selectOption(
    user,
    "Workspace",
    "Current repository (uncommitted changes)",
  );
  await waitFor(() => assert.equal(revision.value, "HEAD"));
  assert.equal(revision.readOnly, true);
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
  assert.equal(call.args.workspace_strategy, "current_repo");
  assert.equal(call.args.revision, "HEAD");
  assert.equal(call.args.repository, "/repo/a");
});

test("delegation defaults to inherited native permissions and separately selects the approval decision maker", async (t) => {
  const { user, transport } = await setup(t);
  await user.click(screen.getByRole("button", { name: "New task" }));
  await screen.findByRole("dialog");
  assert.equal(
    screen.getByRole("combobox", { name: "Permission mode" }).textContent,
    "Your Claude Code settings",
  );
  await selectOption(user, "Permission mode", "Accept edits");
  await selectOption(user, "Approval decision maker", "Parent agent");
  await enterTask(user, "Review authentication with parent approvals");
  await user.click(screen.getByRole("button", { name: "Start task" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.find((call) => call.name === "start_agent_task")?.args
        .approval_decider,
      "parent_agent",
    ),
  );
  assert.equal(
    transport.calls.find((call) => call.name === "start_agent_task")?.args
      .permission_mode,
    "acceptEdits",
  );
});

test("global UI adds a manually entered project only after explicit submission and selects it", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) => configureProjectRegistration(transport),
    { mode: "console" },
  );
  await user.click(screen.getByRole("button", { name: "Add project" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(
    within(dialog).getByLabelText("Repository path"),
    "/repo/new-project",
  );
  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );
  await user.click(within(dialog).getByRole("button", { name: "Add project" }));
  await waitFor(() =>
    assert.equal(controller.getSnapshot().repository, "/repo/new-project"),
  );
  assert.deepEqual(
    transport.calls.find((call) => call.name === "register_user_agent_project")
      ?.args,
    { repository: "/repo/new-project" },
  );
  assert.ok(
    controller
      .getSnapshot()
      .projects.some((project) => project.repository === "/repo/new-project"),
  );
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));
});

test("browsing a folder fills the project draft without granting access", async (t) => {
  const { transport, user } = await setup(
    t,
    (transport) =>
      configureProjectRegistration(transport, { picked: "/repo/picked" }),
    { mode: "console" },
  );
  await user.click(screen.getByRole("button", { name: "Add project" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));
  await waitFor(() =>
    assert.equal(
      (within(dialog).getByLabelText("Repository path") as HTMLInputElement)
        .value,
      "/repo/picked",
    ),
  );
  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));
  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );
});

test("cancelling the native picker preserves the manual project path", async (t) => {
  const { transport, user } = await setup(
    t,
    (transport) => configureProjectRegistration(transport),
    { mode: "console" },
  );
  await user.click(screen.getByRole("button", { name: "Add project" }));
  const dialog = await screen.findByRole("dialog");
  const path = within(dialog).getByLabelText(
    "Repository path",
  ) as HTMLInputElement;
  await user.type(path, "/repo/manual-draft");
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));
  await waitFor(() =>
    assert.ok(
      transport.calls.some((call) => call.name === "browse_user_agent_project"),
    ),
  );
  assert.equal(path.value, "/repo/manual-draft");
  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );
});

test("project registration errors preserve the draft and do not change the selected project", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) =>
      configureProjectRegistration(transport, {
        registerError: "Use repository root",
      }),
    { mode: "console" },
  );
  await user.click(screen.getByRole("button", { name: "Add project" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(
    within(dialog).getByLabelText("Repository path"),
    "/repo/invalid/src",
  );
  await user.click(within(dialog).getByRole("button", { name: "Add project" }));
  await screen.findByText("Use repository root");
  assert.equal(
    (within(dialog).getByLabelText("Repository path") as HTMLInputElement)
      .value,
    "/repo/invalid/src",
  );
  assert.equal(controller.getSnapshot().repository, undefined);
  assert.equal(transport.projects.length, 1);
});

test("permission cancellation keeps the request pending and approval includes the optional message", async (t) => {
  const { user, transport } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "message-request",
      tool: "Bash",
      input: { command: "pwd" },
    };
  });
  await user.click(screen.getByRole("button", { name: "Review request" }));
  await screen.findByRole("dialog");
  await user.type(
    screen.getByLabelText("Message (optional)"),
    "Draft decision",
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));
  assert.equal(
    transport.calls.filter((call) => call.name === "submit_agent_input").length,
    0,
  );
  assert.equal(transport.tasks[0].pending_input?.id, "message-request");
  await user.click(screen.getByRole("button", { name: "Review request" }));
  await screen.findByRole("dialog");
  await user.type(
    screen.getByLabelText("Message (optional)"),
    "Only run this command",
  );
  await user.click(
    screen.getByRole("button", { name: "Approve this request once" }),
  );
  await waitFor(() =>
    assert.deepEqual(
      transport.calls.find((call) => call.name === "submit_agent_input")?.args,
      {
        task_id: "one",
        request_id: "message-request",
        approved: true,
        message: "Only run this command",
      },
    ),
  );
});

test("a chat project hint prefills registration without registering it automatically", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) =>
    configureProjectRegistration(transport),
  );
  await act(() =>
    controller.applyScope({
      panel_scope: { conversation_id: "chat-project" },
      panel_project_candidate: { repository: "/repo/chat-project" },
    }),
  );
  await user.click(screen.getByRole("button", { name: "Add chat project" }));
  const dialog = await screen.findByRole("dialog");
  assert.equal(
    (within(dialog).getByLabelText("Repository path") as HTMLInputElement)
      .value,
    "/repo/chat-project",
  );
  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );
  await user.click(within(dialog).getByRole("button", { name: "Add project" }));
  await waitFor(() =>
    assert.equal(controller.getSnapshot().repository, "/repo/chat-project"),
  );
});

test("folder picker failure keeps manual entry available", async (t) => {
  const { transport, user } = await setup(
    t,
    (transport) =>
      configureProjectRegistration(transport, {
        browseError: "Native folder picker unavailable",
      }),
    { mode: "console" },
  );
  await user.click(screen.getByRole("button", { name: "Add project" }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));
  await within(dialog).findByText("Native folder picker unavailable");
  const path = within(dialog).getByLabelText("Repository path");
  await user.type(path, "/repo/manual-fallback");
  await user.click(within(dialog).getByRole("button", { name: "Add project" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.find(
        (call) => call.name === "register_user_agent_project",
      )?.args.repository,
      "/repo/manual-fallback",
    ),
  );
});

test("a delayed native folder selection cannot overwrite a new project dialog after scope changes", async (t) => {
  let finish!: (result: { repository: string }) => void;
  const { controller, transport, user } = await setup(
    t,
    (transport) => {
      configureProjectRegistration(transport);
      const original = transport.tool.bind(transport);
      transport.tool = async <T>(
        name: string,
        args: Record<string, unknown> = {},
      ): Promise<T> => {
        if (name === "browse_user_agent_project") {
          transport.calls.push({ name, args });
          return new Promise<{ repository: string }>((resolve) => {
            finish = resolve;
          }) as Promise<T>;
        }
        return original<T>(name, args);
      };
    },
    { mode: "console" },
  );
  await user.click(screen.getByRole("button", { name: "Add project" }));
  const firstDialog = await screen.findByRole("dialog");
  await user.click(
    within(firstDialog).getByRole("button", { name: "Browse…" }),
  );
  await act(() =>
    controller.applyScope({
      panel_scope: { conversation_id: null, repository: "/repo/other" },
    }),
  );
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));
  await user.click(screen.getByRole("button", { name: "Add project" }));
  const dialog = await screen.findByRole("dialog");
  const path = within(dialog).getByLabelText(
    "Repository path",
  ) as HTMLInputElement;
  await user.type(path, "/repo/new-draft");
  await act(async () => {
    finish({ repository: "/repo/stale-selection" });
  });
  assert.equal(path.value, "/repo/new-draft");
  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );
});

test("browsing a project inside delegation preserves the draft and starts only after Start task", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) =>
    configureProjectRegistration(transport, {
      picked: "/repo/alias",
      canonicalRepository: "/repo/canonical",
    }),
  );
  await user.click(screen.getByRole("button", { name: "New task" }));
  const dialog = await screen.findByRole("dialog");
  await enterTask(user, "Review this new project with my draft intact");
  await selectOption(user, "Worker", "codex · reviewer");
  const runtime = screen.getByLabelText("Runtime limit · minutes");
  await user.clear(runtime);
  await user.type(runtime, "12.5");
  const scope = controller.getSnapshot().repository;
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));
  await waitFor(() =>
    assert.match(
      within(dialog).getByRole("combobox", { name: "Project" }).textContent ??
        "",
      /canonical/,
    ),
  );
  assert.equal(controller.getSnapshot().repository, scope);
  assert.equal(
    (within(dialog).getByLabelText("Description") as HTMLTextAreaElement).value,
    "Review this new project with my draft intact",
  );
  assert.equal((runtime as HTMLInputElement).value, "12.5");
  assert.match(
    within(dialog).getByRole("combobox", { name: "Worker" }).textContent ?? "",
    /codex/,
  );
  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
  assert.deepEqual(
    transport.calls.find((call) => call.name === "register_user_agent_project")
      ?.args,
    { repository: "/repo/alias" },
  );
  await user.click(within(dialog).getByRole("button", { name: "Start task" }));
  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_agent_task").length,
      1,
    ),
  );
  const started = transport.calls.find(
    (call) => call.name === "start_agent_task",
  )!;
  assert.equal(started.args.repository, "/repo/canonical");
  assert.equal(
    started.args.description,
    "Review this new project with my draft intact",
  );
  assert.equal(started.args.provider, "codex");
  assert.equal(
    (started.args.budget as { max_runtime_minutes: number })
      .max_runtime_minutes,
    12.5,
  );
});

test("task project registration failure preserves the selected project and draft", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureProjectRegistration(transport, {
      picked: "/repo/new/src",
      registerError: "Use repository root",
    }),
  );
  await user.click(screen.getByRole("button", { name: "New task" }));
  const dialog = await screen.findByRole("dialog");
  await enterTask(user, "Keep this description after registration failure");
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));
  await within(dialog).findByText("Use repository root");
  assert.equal(
    within(dialog).getByRole("combobox", { name: "Project" }).textContent,
    "/repo/a",
  );
  assert.equal(
    (within(dialog).getByLabelText("Description") as HTMLTextAreaElement).value,
    "Keep this description after registration failure",
  );
  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
});

test("cancelling the task project picker preserves selection and task draft without registering", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureProjectRegistration(transport),
  );
  await user.click(screen.getByRole("button", { name: "New task" }));
  const dialog = await screen.findByRole("dialog");
  await enterTask(user, "Preserve task while browsing");
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));
  await waitFor(() =>
    assert.equal(
      (
        within(dialog).getByRole("button", {
          name: "Browse…",
        }) as HTMLButtonElement
      ).disabled,
      false,
    ),
  );
  assert.equal(
    within(dialog).getByRole("combobox", { name: "Project" }).textContent,
    "/repo/a",
  );
  assert.equal(
    (within(dialog).getByLabelText("Description") as HTMLTextAreaElement).value,
    "Preserve task while browsing",
  );
  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );
  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
});

test("pending task project browsing disables Start and ignores selection after scope changes", async (t) => {
  let finish!: (result: { repository: string }) => void;
  const { controller, transport, user } = await setup(t, (transport) => {
    configureProjectRegistration(transport);
    const original = transport.tool.bind(transport);
    transport.tool = async <T>(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<T> => {
      if (name === "browse_user_agent_project") {
        transport.calls.push({ name, args });
        return new Promise<{ repository: string }>((resolve) => {
          finish = resolve;
        }) as Promise<T>;
      }
      return original<T>(name, args);
    };
  });
  await user.click(screen.getByRole("button", { name: "New task" }));
  const dialog = await screen.findByRole("dialog");
  await enterTask(user, "A pending folder selection");
  const start = within(dialog).getByRole("button", {
    name: "Start task",
  }) as HTMLButtonElement;
  await user.click(within(dialog).getByRole("button", { name: "Browse…" }));
  assert.equal(start.disabled, true);
  await act(() =>
    controller.applyScope({ panel_scope: { conversation_id: "new-chat" } }),
  );
  await act(async () => {
    finish({ repository: "/repo/stale-selection" });
  });
  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );
  assert.equal(
    transport.calls.filter((call) => call.name === "start_agent_task").length,
    0,
  );
});

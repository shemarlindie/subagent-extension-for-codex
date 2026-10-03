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
                    minimum: 1,
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
  assert.equal(screen.queryByRole("button", { name: "Open" }), null);
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
  process.stderr.write("READY\n");
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  assert.deepEqual(
    transport.calls.find((call) => call.name === "update_agent_settings")!.args,
    { set: { use_cost_budget: true, default_model: "model-a" } },
  );
});


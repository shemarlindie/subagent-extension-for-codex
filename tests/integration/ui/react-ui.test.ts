// @vitest-environment jsdom
import assert from "node:assert/strict";

import { describe, test, type TestContext, vi } from "vitest";

import type {
  ChangedFileContent,
  Changes,
} from "../../../ui/features/changes/types";
import type {
  HostState,
  Project,
  SettingsDocument,
  Task,
  Transport,
  TransportEvents,
} from "../../../ui/shared/state/types";

// UI primitives read browser capabilities at module initialization.
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

import { AppShell } from "../../../ui/app/shells/app-shell";
import { SKIPPED_ANSWER } from "../../../ui/features/tasks/controls/question-form";
import { Controller } from "../../../ui/shared/state/controller";
import { ControllerContext } from "../../../ui/shared/state/controller-context";

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
  events!: TransportEvents;
  tasks = [task()];
  projects: Project[] = [{ repository: "/repo/a", kind: "repository" }];
  calls: { name: string; args: Record<string, unknown> }[] = [];
  /** get_user_agent_changes pages; a cursor is the next page's index. */
  changes: Changes[] = [
    { scope: "task", files: [], additions: 0, deletions: 0, diff: "" },
  ];

  /** get_user_agent_changed_file results by path. */
  changedFiles: Record<string, ChangedFileContent> = {};
  shared: Record<string, unknown>[] = [];
  messages: string[] = [];
  async share(data: Record<string, unknown>) {
    this.shared.push(data);
  }

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
      get_user_agent_changes: this.changes[Number(args.cursor ?? 0)],
      get_user_agent_changed_file: this.changedFiles[String(args.path)],
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
    wide?: boolean;
    scoped?: boolean;
    displayMode?: HostState["displayMode"];
    start?: boolean;
  } = {},
) {
  const transport = new FakeTransport();

  if (options.displayMode) transport.host.displayMode = options.displayMode;
  configure?.(transport);

  const controller = new Controller(transport, {
    hidden: () => false,
    wide: () => options.wide ?? true,
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

// Serves a settings document and records updates without applying them.
function serveSettings(
  transport: FakeTransport,
  document: Pick<SettingsDocument, "sections"> &
    Partial<Pick<SettingsDocument, "values" | "defaults">>,
) {
  const original = transport.tool.bind(transport);

  transport.tool = async <T>(name: string, args = {}) => {
    if (name === "update_agent_settings") {
      transport.calls.push({ name, args });

      return { values: {} } as T;
    }

    if (name === "get_agent_settings")
      return {
        schema: { type: "object", properties: {} },
        values: {},
        defaults: {},
        ...document,
      } as T;

    return original<T>(name, args);
  };
}

const effortOptions = [
  { value: "default", label: "Inherit" },
  { value: "high", label: "high" },
];

// A model scope row; without `options` the model is typed.
const scope = (
  key: string,
  label: string,
  options?: { value: string; label: string; description?: string }[],
  unsupported = false,
) => ({
  label,
  model: { key: `${key}_model`, label: `${label} model`, options },
  effort: {
    key: `${key}_reasoning_effort`,
    label: `${label} effort`,
    options: effortOptions,
    unsupported,
  },
});

const budgetRow = {
  kind: "budget" as const,
  key: "max_cost_usd",
  toggle: "use_cost_budget",
  label: "Cost limit",
  unit: "USD",
  min: 0.01,
  max: 100,
  amount: 5,
};

test("settings dialog renders server sections and saves only changed fields", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    serveSettings(transport, {
      values: {
        default_workspace_strategy: "current_repo",
        claude_subagents: true,
        max_cost_usd: null,
        default_model: "",
        default_reasoning_effort: "default",
      },
      sections: [
        {
          id: "task",
          title: "Task",
          help: ["Used when a task doesn't choose its own."],
          rows: [
            {
              kind: "select",
              key: "default_workspace_strategy",
              label: "Workspace",
              options: [
                { value: "current_repo", label: "Current repository" },
                { value: "worktree", label: "Isolated worktree" },
              ],
            },
            {
              kind: "switch",
              key: "claude_subagents",
              label: "Allow subagents",
            },
            budgetRow,
          ],
        },
        {
          id: "models",
          title: "Models",
          rows: [
            {
              kind: "models",
              scopes: [
                scope("default", "Global", [
                  { value: "", label: "Inherit" },
                  {
                    value: "model-a",
                    label: "Model A",
                    description: "Fast model",
                  },
                ]),
              ],
            },
          ],
        },
      ],
    }),
  );

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("dialog");
  assert.ok(screen.getByText("Used when a task doesn't choose its own."));

  // Collapsed sections summarize with the server's labels.
  const models = screen.getByRole("button", { name: /^Models/ });
  assert.equal(models.getAttribute("aria-expanded"), "false");

  assert.equal(
    models.querySelector(".settings-group-summary")?.textContent,
    "All inherit",
  );

  const save = screen.getByRole("button", { name: "Save settings" });
  assert.equal((save as HTMLButtonElement).disabled, true);
  await user.click(screen.getByRole("switch", { name: "Allow subagents" }));
  await user.click(screen.getByRole("switch", { name: "Cost limit" }));
  await user.click(models);

  // Menu options show the server's description as secondary text.
  await user.click(screen.getByRole("combobox", { name: "Global model" }));
  const option = await screen.findByRole("option", { name: /Model A/ });

  assert.equal(
    option.querySelector(".select-item-description")?.textContent,
    "Fast model",
  );

  await user.click(option);

  assert.equal(
    models.querySelector(".settings-group-summary")?.textContent,
    "Global: Model A",
  );

  // One badge per section with edits; the budget counts once.
  assert.deepEqual(
    screen
      .getAllByText(/changed$/, { selector: ".settings-group-badge" })
      .map((b) => b.textContent),
    ["2 changed", "1 changed"],
  );

  await user.click(screen.getByRole("button", { name: "Save 3 changes" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

  assert.deepEqual(
    transport.calls.find((call) => call.name === "update_agent_settings")!.args,
    {
      set: {
        claude_subagents: false,
        use_cost_budget: true,
        max_cost_usd: 5,
        default_model: "model-a",
      },
    },
  );
});

test("settings dialog validates hidden budgets, types uncatalogued models, and flags unsupported effort", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    serveSettings(transport, {
      values: {
        max_cost_usd: null,
        default_model: "",
        default_reasoning_effort: "high",
        researcher_default_model: "",
        researcher_default_reasoning_effort: "default",
      },
      sections: [
        { id: "budgets", title: "Budgets", rows: [budgetRow] },
        {
          id: "models",
          title: "Models",
          rows: [
            {
              kind: "models",
              scopes: [
                scope(
                  "default",
                  "Global",
                  [{ value: "", label: "Inherit" }],
                  true,
                ),
                scope("researcher_default", "Researcher"),
              ],
            },
          ],
        },
      ],
    }),
  );

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("dialog");

  // An off limit keeps its amount visible but prevents edits.
  const amount = screen.getByRole("spinbutton", { name: "Cost limit (USD)" });
  assert.ok(amount.closest(".setting-amount")!.hasAttribute("data-off"));
  assert.equal((amount as HTMLInputElement).disabled, true);
  const savedAmount = (amount as HTMLInputElement).value;

  await user.type(amount, "500");
  assert.equal((amount as HTMLInputElement).value, savedAmount);

  assert.equal(
    (screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement)
      .disabled,
    true,
  );

  assert.equal(
    transport.calls.some((call) => call.name === "update_agent_settings"),
    false,
  );

  await user.click(screen.getByRole("switch", { name: "Cost limit" }));
  assert.equal((amount as HTMLInputElement).disabled, false);
  assert.equal((amount as HTMLInputElement).value, savedAmount);

  assert.equal(
    amount.closest(".setting-amount")!.hasAttribute("data-off"),
    false,
  );

  await user.clear(amount);

  await user.click(screen.getByRole("button", { name: /^Models/ }));

  assert.equal(
    screen
      .getByRole("button", { name: /^Budgets/ })
      .getAttribute("aria-expanded"),
    "false",
  );

  // The server flags an unsupported saved effort.
  assert.ok(
    screen.getByText("The saved effort is not supported by this model."),
  );

  // A model without discovered choices is typed.
  await user.type(
    screen.getByRole("textbox", { name: "Researcher model" }),
    "custom-id",
  );

  // The cleared amount is in the closed Budgets section: saving reopens it
  // and focuses the amount instead of sending an invalid value.
  await user.click(screen.getByRole("button", { name: "Save 2 changes" }));

  assert.equal(
    screen
      .getByRole("button", { name: /^Budgets/ })
      .getAttribute("aria-expanded"),
    "true",
  );

  await waitFor(() => assert.equal(document.activeElement, amount));

  assert.equal(
    transport.calls.some((call) => call.name === "update_agent_settings"),
    false,
  );

  await user.type(amount, "8");
  await user.click(screen.getByRole("button", { name: "Save 2 changes" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

  assert.deepEqual(
    transport.calls.find((call) => call.name === "update_agent_settings")!.args,
    {
      set: {
        use_cost_budget: true,
        max_cost_usd: 8,
        researcher_default_model: "custom-id",
      },
    },
  );
});

test("settings explain invalid disabled budgets and let the user restore editing", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    serveSettings(transport, {
      values: { max_cost_usd: 5 },
      sections: [{ id: "task", title: "Task", rows: [budgetRow] }],
    }),
  );

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("dialog");

  const amount = screen.getByRole("spinbutton", { name: "Cost limit (USD)" }),
    toggle = screen.getByRole("switch", { name: "Cost limit" });

  await user.clear(amount);
  await user.type(amount, "500");
  await user.click(toggle);
  await user.click(screen.getByRole("button", { name: "Save 1 change" }));
  await screen.findByText("Enter an amount from 0.01 to 100 USD.");
  assert.equal(amount.getAttribute("aria-invalid"), "true");
  await waitFor(() => assert.equal(document.activeElement, toggle));

  assert.equal(
    transport.calls.some((call) => call.name === "update_agent_settings"),
    false,
  );

  await user.click(toggle);
  await user.clear(amount);
  await user.type(amount, "8");
  await user.click(toggle);
  await user.click(screen.getByRole("button", { name: "Save 1 change" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

  assert.deepEqual(
    transport.calls.find((call) => call.name === "update_agent_settings")!.args,
    { set: { use_cost_budget: false, max_cost_usd: 8 } },
  );
});

test("settings help links show the setting they name, except within their own section", async (t) => {
  // Section help links by setting key; the trailing "profiles" is plain text,
  // so the link lookups below would fail on a second match.
  const help = [
    "Falls back to ",
    { text: "profiles", setting: "reviewer_default_model" },
    ", then ",
    { text: "defaults", setting: "default_model" },
    ". Not profiles.",
  ];

  const { user } = await setup(t, (transport) =>
    serveSettings(transport, {
      values: {
        default_model: "",
        default_reasoning_effort: "default",
        reviewer_default_model: "",
        reviewer_default_reasoning_effort: "default",
      },
      sections: [
        ["defaults", "Defaults", "default"],
        ["profiles", "Profiles", "reviewer_default"],
      ].map(([id, title, key]) => ({
        id,
        title,
        help,
        rows: [{ kind: "models" as const, scopes: [scope(key, `${key}`)] }],
      })),
    }),
  );

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("dialog");

  const expanded = (name: RegExp) =>
    screen.getByRole("button", { name }).getAttribute("aria-expanded");

  // Links into the open section stay plain text.
  assertAbsent(screen.queryByRole("button", { name: "defaults" }));
  const link = screen.getByRole("button", { name: "profiles" });
  assert.equal(link.getAttribute("title"), "Show in Profiles");

  // A link opens its setting's section and focuses that setting's field.
  await user.click(link);
  assert.equal(expanded(/^Profiles/), "true");
  assert.equal(expanded(/^Defaults/), "false");

  assert.equal(
    document.activeElement,
    screen.getByRole("textbox", { name: "reviewer_default model" }),
  );

  assertAbsent(screen.queryByRole("button", { name: "profiles" }));
  await user.click(screen.getByRole("button", { name: "defaults" }));
  assert.equal(expanded(/^Defaults/), "true");

  assert.equal(
    document.activeElement,
    screen.getByRole("textbox", { name: "default model" }),
  );
});

test("settings resets restore defaults only per section", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    serveSettings(transport, {
      values: {
        claude_subagents: false,
        max_cost_usd: null,
        default_model: "saved-model",
        default_reasoning_effort: "high",
      },
      defaults: {
        claude_subagents: true,
        max_cost_usd: 5,
        default_model: "",
        default_reasoning_effort: "default",
      },
      sections: [
        {
          id: "task",
          title: "Task",
          rows: [
            {
              kind: "switch",
              key: "claude_subagents",
              label: "Allow subagents",
            },
            budgetRow,
          ],
        },
        {
          id: "models",
          title: "Models",
          rows: [{ kind: "models", scopes: [scope("default", "Global")] }],
        },
      ],
    }),
  );

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("dialog");
  const subagents = screen.getByRole("switch", { name: "Allow subagents" });

  // Resetting Task must preserve another section's saved override and draft.
  await user.click(screen.getByRole("button", { name: /^Models/ }));
  const model = screen.getByRole("textbox", { name: "Global model" });
  await user.clear(model);
  await user.type(model, "draft-model");
  await user.click(screen.getByRole("button", { name: /^Task/ }));

  assertAbsent(screen.queryByRole("button", { name: "Reset" }));

  await user.click(screen.getByRole("button", { name: "Reset to defaults" }));
  assert.equal(subagents.getAttribute("aria-checked"), "true");

  assert.equal(
    screen
      .getByRole("switch", { name: "Cost limit" })
      .getAttribute("aria-checked"),
    "true",
  );

  assertAbsent(screen.queryByRole("button", { name: /^Reset/ }));
  await user.click(screen.getByRole("button", { name: /^Models/ }));
  assert.equal((model as HTMLInputElement).value, "draft-model");

  assert.equal(
    screen.getByRole("combobox", { name: "Global effort" }).textContent,
    "high",
  );

  await user.click(screen.getByRole("button", { name: "Save 3 changes" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

  assert.deepEqual(
    transport.calls.find((call) => call.name === "update_agent_settings")!.args,
    {
      set: {
        claude_subagents: true,
        use_cost_budget: true,
        max_cost_usd: 5,
        default_model: "draft-model",
      },
    },
  );
});

test("closing settings with unsaved edits asks before discarding them", async (t) => {
  const originalMatchMedia = Object.getOwnPropertyDescriptor(
    window,
    "matchMedia",
  );

  let prefersReducedMotion = false;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches:
        query === "(prefers-reduced-motion: reduce)" && prefersReducedMotion,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => true,
    }),
  });

  const originalScroll = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollIntoView",
  );

  const scrolls: {
    element: HTMLElement;
    options?: boolean | ScrollIntoViewOptions;
  }[] = [];

  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value(this: HTMLElement, options?: boolean | ScrollIntoViewOptions) {
      scrolls.push({ element: this, options });
    },
  });

  t.onTestFinished(() => {
    if (originalMatchMedia)
      Object.defineProperty(window, "matchMedia", originalMatchMedia);
    else delete (window as Partial<Window>).matchMedia;

    if (originalScroll)
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        originalScroll,
      );
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  const { transport, user } = await setup(t, (transport) =>
    serveSettings(transport, {
      values: { claude_subagents: true },
      sections: [
        {
          id: "task",
          title: "Task",
          rows: [
            {
              kind: "switch",
              key: "claude_subagents",
              label: "Allow subagents",
            },
          ],
        },
      ],
    }),
  );

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("dialog");

  // Without edits, Cancel closes at once.
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("dialog");
  await user.click(screen.getByRole("switch", { name: "Allow subagents" }));

  // Cancel and Escape both ask first; keeping edits leaves them in place.
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  const assertPromptVisible = (behavior: ScrollBehavior = "smooth") => {
    const prompt = screen.getByText("Discard unsaved changes?"),
      notice = prompt.closest(".notice"),
      anchor = prompt.closest(".settings-discard-anchor");

    assert.equal(notice?.getAttribute("data-tone"), "warning");

    assert.equal(
      document.activeElement,
      screen.getByRole("button", { name: "Keep editing" }),
    );

    assert.equal(scrolls.at(-1)?.element, anchor);
    assert.deepEqual(scrolls.at(-1)?.options, { block: "end", behavior });
  };

  assertPromptVisible();
  assert.equal(scrolls.length, 1);
  await user.click(screen.getByRole("button", { name: "Keep editing" }));

  assert.ok(
    screen
      .getByText("Discard unsaved changes?")
      .closest(".settings-discard-anchor")
      ?.hasAttribute("hidden"),
  );

  assert.ok(screen.getByRole("button", { name: "Save 1 change" }));

  await user.keyboard("{Escape}");
  assert.ok(screen.getByRole("dialog"));
  assertPromptVisible();
  assert.equal(scrolls.length, 2);
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  prefersReducedMotion = true;
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  assertPromptVisible("instant");
  assert.equal(scrolls.length, 3);
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  prefersReducedMotion = false;
  await user.keyboard("{Escape}");
  assertPromptVisible();
  assert.equal(scrolls.length, 4);
  await user.click(screen.getByRole("button", { name: "Discard" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog")));

  await user.click(screen.getByRole("button", { name: "Settings" }));
  await screen.findByRole("dialog");

  assert.equal(
    screen
      .getByRole("switch", { name: "Allow subagents" })
      .getAttribute("aria-checked"),
    "true",
  );

  assert.equal(
    (screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement)
      .disabled,
    true,
  );

  assert.equal(
    transport.calls.some((call) => call.name === "update_agent_settings"),
    false,
  );
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

  await user.click(screen.getByRole("button", { name: "New Task" }));
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

  await user.click(screen.getByRole("button", { name: "New Task" }));
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

  await user.click(screen.getByRole("button", { name: "New Task" }));
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
  await user.click(screen.getByRole("button", { name: "New Task" }));
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

  await user.click(screen.getByRole("button", { name: "New Task" }));
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

  await user.click(screen.getByRole("button", { name: "New Task" }));
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
  layoutExpandableNotice(true);

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

  const toggle = descriptionToggle(document.body);

  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await user.click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");

  const panel = toggle.querySelector(".notice-expand-text")!;

  assert.equal(panel.textContent, literal);
  assertAbsent(panel.querySelector("img"));

  transport.tasks[0] = {
    ...transport.tasks[0],
    description: literal + " Updated.",
  };

  await act(() => controller.refresh());

  assert.ok(
    descriptionToggle(document.body) === toggle,
    "Refresh retains the description toggle node",
  );

  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(panel.textContent, literal + " Updated.");
  await user.click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await user.click(toggle);
  await act(() => controller.select("two"));
  const next = descriptionToggle(document.body);
  assert.equal(next.getAttribute("aria-expanded"), "false");
  await user.click(next);

  assert.equal(
    next.querySelector(".notice-expand-text")!.textContent,
    "Second instructions",
  );
});

test("a description that fits on one line has no toggle", async (t) => {
  layoutExpandableNotice(false);

  await setup(t);

  assert.equal(
    document.querySelector(".notice-expand-text")?.textContent,
    "Review authentication and report relevant findings.",
  );

  assertAbsent(descriptionToggle(document.body));
});

// jsdom has no layout; model visible text and its measured expanded height.
function layoutExpandableNotice(overflowing: boolean) {
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(
    function (this: HTMLElement) {
      return this.matches(".notice-expand-text")
        ? ({ length: 1, item: () => null } as unknown as DOMRectList)
        : ({ length: 0, item: () => null } as unknown as DOMRectList);
    },
  );

  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.matches(".notice-expand-text[data-open]")
        ? overflowing
          ? 80
          : 18
        : 0;
    },
  );

  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.matches(".notice-expand-text") ? 18 : 0;
    },
  );
}

// The toggle's name is the description's first line, so find it by tone.
function descriptionToggle(root: HTMLElement) {
  return root.querySelector<HTMLElement>(
    '[data-tone="plain"] button.notice-trigger',
  )!;
}

for (const action of ["interrupt", "cancel", "retry"] as const) {
  test(`${action} confirmation defaults the task description ${action === "retry" ? "closed" : "open"}`, async (t) => {
    layoutExpandableNotice(true);

    const { controller, transport, user } = await setup(t);

    await act(() =>
      controller.open({ kind: "control", action, task: transport.tasks[0] }),
    );

    const dialog = await screen.findByRole("dialog");
    const toggle = descriptionToggle(dialog);
    const expanded = action !== "retry";
    assert.equal(toggle.getAttribute("aria-expanded"), String(expanded));

    if (expanded) {
      assert.equal(
        dialog.querySelector(".notice-expand-text")?.textContent,
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

  assert.equal(
    document.querySelector(".row-title")?.textContent,
    "Review authentication",
  );

  assertAbsent(screen.queryByRole("button", { name: /^Other task/ }));
  await act(() => controller.setSearch(""));
  await user.click(screen.getByRole("button", { name: "New Task" }));
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
  assertAbsent(screen.queryByRole("button", { name: "New Task" }));
  assertAbsent(screen.queryByRole("region", { name: "Task inspector" }));

  assertAbsent(
    screen.queryByRole("complementary", { name: "Delegated tasks" }),
  );

  await user.click(screen.getByRole("button", { name: "Open panel" }));
  assert.equal(transport.expandCalls, 1);
  assert.equal(controller.getSnapshot().selected, "two");
  assert.ok(screen.getByRole("button", { name: "New Task" }));

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
  const trigger = screen.getByRole("button", { name: "More actions" });
  await user.hover(trigger);

  assert.equal(
    (await screen.findByRole("tooltip")).textContent,
    "More actions",
  );

  await user.unhover(trigger);
  await user.click(trigger);

  assert.deepEqual(
    (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
    ["Refresh", "Settings"],
  );

  await user.click(screen.getByRole("menuitem", { name: "Settings" }));

  await waitFor(() =>
    assert.ok(
      transport.calls.some((call) => call.name === "get_agent_settings"),
    ),
  );
});

test("a thread panel leaves global actions to global launches", async (t) => {
  const { controller, user } = await setup(t);

  assert.ok(document.querySelector("header .brand-global"));
  assertAbsent(document.querySelector("header .brand .mark"));
  assertAbsent(document.querySelector("header .brand-text strong"));
  assert.ok(document.querySelector("header .brand [role=status]"));

  await act(() =>
    controller.applyScope({ panel_scope: { conversation_id: "thread" } }),
  );

  assertAbsent(document.querySelector("header .brand-global"));
  assert.ok(document.querySelector("header .brand .mark"));

  assert.equal(
    document.querySelector("header .brand-text strong")?.textContent,
    "Delegated Work",
  );

  assertAbsent(screen.queryByRole("button", { name: "Project" }));
  assertAbsent(screen.queryByRole("button", { name: "Settings" }));
  assertAbsent(screen.queryByRole("button", { name: "New Task" }));
  await user.click(screen.getByRole("button", { name: "More actions" }));

  assert.deepEqual(
    (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
    ["Refresh"],
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
  assertAbsent(screen.queryByRole("button", { name: "New Task" }));
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
  await user.click(screen.getByRole("button", { name: "New Task" }));
  const field = await screen.findByLabelText("Description");
  await user.type(field, "Preserve this suspended draft");
  const dialogState = controller.getSnapshot().dialog;
  await act(() => transport.expand());
  assert.ok(screen.getByRole("region", { name: "Delegated Work preview" }));
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
  await user.click(screen.getAllByRole("button", { name: "New Task" })[0]);
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

describe("nonembedded panels retain the full interface in inline mode", () => {
  test("nonembedded panel", async (t) => {
    await setup(
      t,
      (transport) => {
        transport.embedded = false;
      },
      { displayMode: "inline" },
    );

    assert.ok(screen.getByRole("button", { name: "New Task" }));
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
    assert.ok(screen.getByRole("region", { name: "Delegated Work preview" }));
    assert.equal(screen.getByRole("status").textContent, "Connecting…");
    assertAbsent(screen.queryByText("No delegated tasks yet."));
    assertAbsent(screen.queryByRole("button", { name: "New Task" }));
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

  const checked = (name: RegExp) =>
    screen.getByRole("radio", { name }).getAttribute("aria-checked");

  // Until one is chosen, the first nonempty filter in order is selected.
  assert.equal(checked(/^Active/), "true");
  assert.equal(checked(/^All/), "false");
  await user.click(screen.getByRole("radio", { name: /^All/ }));
  assert.equal(checked(/^All/), "true");
  assert.equal(checked(/^Active/), "false");
  // Clicking the selected filter must not leave the list with no filter.
  await user.click(screen.getByRole("radio", { name: /^All/ }));
  assert.equal(checked(/^All/), "true");
});

test("task filters list the nonempty filters in priority order", async (t) => {
  await setup(t);

  const names = screen
    .getAllByRole("radio")
    .map((radio) => radio.getAttribute("data-filter"));

  assert.deepEqual(names, ["active", "all"]);
  assertAbsent(screen.queryByRole("radio", { name: /^Failed/ }));
  assertAbsent(screen.queryByRole("radio", { name: /^Done/ }));
});

test("task filters show counts and an empty state with a way out", async (t) => {
  const { user } = await setup(t);
  assert.ok(screen.getByRole("radio", { name: "All, 1" }));
  assert.ok(screen.getByRole("radio", { name: "Active, 1" }));
  assertAbsent(screen.queryByRole("button", { name: "Clear filter" }));
  const search = screen.getByRole("searchbox", { name: "Search tasks" });
  await user.type(search, "zzz");

  // Counts follow the search, so no filter promises tasks the list cannot show.
  // With nothing left, only All remains, so the row keeps its place.
  assert.deepEqual(
    screen
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("data-filter")),
    ["all"],
  );

  assert.ok(screen.getByRole("radio", { name: "All, 0" }));
  assert.ok(screen.getByText("No tasks match “zzz”."));
  assert.equal(screen.getByText("0 of 1").id, "count");
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  assert.equal((search as HTMLInputElement).value, "");
  await user.type(search, "a");
  await user.click(screen.getByRole("button", { name: "Clear filter" }));
  assert.equal((search as HTMLInputElement).value, "");

  assert.equal(
    screen.getByRole("radio", { name: /^All/ }).getAttribute("aria-checked"),
    "true",
  );
});

test("a chosen filter stays visible after it empties", async (t) => {
  const { user } = await setup(t);
  await user.click(screen.getByRole("radio", { name: /^Active/ }));

  await user.type(
    screen.getByRole("searchbox", { name: "Search tasks" }),
    "zzz",
  );

  assert.ok(screen.getByRole("radio", { name: "Active, 0" }));
  assert.ok(screen.getByText("No tasks match “zzz” in Active."));
  await user.click(screen.getByRole("button", { name: "Clear filter" }));

  assert.equal(
    screen.getByRole("radio", { name: /^All/ }).getAttribute("aria-checked"),
    "true",
  );
});

test("the all-project task list shows each project above its task title", async (t) => {
  await setup(t, (transport) => {
    transport.tasks = [
      { ...task(), title: "Review authentication" },
      { ...task("two", "/repo/b"), title: "Update database" },
    ];

    transport.projects = [
      { repository: "/repo/a", name: "Alpha", kind: "repository" },
      { repository: "/repo/b", name: "", kind: "repository" },
    ];
  });

  const projectByTitle = new Map(
    [...document.querySelectorAll(".row")].map((row) => [
      row.querySelector(".row-title")?.textContent,
      row.querySelector(".row-project")?.textContent,
    ]),
  );

  assert.deepEqual(
    [...projectByTitle],
    [
      ["Review authentication", "Alpha"],
      ["Update database", "b"],
    ],
  );

  for (const row of document.querySelectorAll(".row")) {
    assert.deepEqual(
      [...row.children].slice(0, 2).map((child) => child.className),
      ["row-project", "row-title"],
    );
  }
});

test("search clears with Escape and focuses with the slash key", async (t) => {
  const { user } = await setup(t);
  const search = screen.getByRole("searchbox", { name: "Search tasks" });
  await user.keyboard("/");
  assert.equal(document.activeElement, search);
  await user.keyboard("abc");
  assert.equal((search as HTMLInputElement).value, "abc");
  await user.keyboard("{Escape}");
  assert.equal((search as HTMLInputElement).value, "");
  assert.equal(document.activeElement, search);
  await user.keyboard("{Escape}");
  assert.notEqual(document.activeElement, search);
  // Typing a slash in another text field leaves the shortcut alone.
  await user.click(screen.getByRole("button", { name: "New Task" }));
  await enterTask(user, "a/b");
  assert.notEqual(document.activeElement, search);
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

  define(screen.getByRole("tab", { name: /^Activity/ }), {
    offsetLeft: 20,
    offsetWidth: 40,
  });

  await user.click(screen.getByRole("tab", { name: /^Activity/ }));

  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("tab", { name: /^Activity/ })
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
  assert.ok(screen.getByRole("tab", { name: /^Activity \d+$/ }));

  assert.deepEqual(
    screen
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.replace(/\s*\d+$/, "")),
    ["Result", "Changes", "Activity", "Details"],
  );

  await user.click(result);
  await user.keyboard("{ArrowRight}{ArrowRight}");

  await waitFor(() =>
    assert.equal(
      screen
        .getByRole("tab", { name: /Activity/ })
        .getAttribute("aria-selected"),
      "true",
    ),
  );

  await waitFor(() =>
    assert.ok(
      document.activeElement === screen.getByRole("tab", { name: /Activity/ }),
    ),
  );

  await act(() => controller.refresh());

  await waitFor(() =>
    assert.ok(
      document.activeElement === screen.getByRole("tab", { name: /Activity/ }),
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

// Two pages of one file each, as the service pages a large diff. The second
// file is binary.
const changePages = (binary = "logo.png"): Changes[] => {
  const files: Changes["files"] = [
    {
      path: "src/a.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      binary: false,
    },
    {
      path: binary,
      status: "added",
      additions: 0,
      deletions: 0,
      binary: true,
      size: 2048,
    },
  ];

  const page = { scope: "task" as const, files, additions: 1, deletions: 1 };

  return [
    {
      ...page,
      diff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old line\n+new line\n",
      next_cursor: "1",
    },
    {
      ...page,
      diff: `diff --git a/${binary} b/${binary}\nnew file mode 100644\nBinary files /dev/null and b/${binary} differ\n`,
    },
  ];
};

test("the Changes tab reads every page and shows the worktree branch and its commands", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.tasks = [
      {
        ...task(),
        branch: "agent/one",
        workspace: "/data/worktrees/one",
        base_commit: "abc123",
      },
    ];

    transport.changes = changePages();
  });

  await user.click(screen.getByRole("tab", { name: "Changes" }));

  await waitFor(() =>
    assert.match(
      document.querySelector(".diff-row.add")?.textContent ?? "",
      /new line/,
    ),
  );

  assert.deepEqual(
    transport.calls
      .filter((call) => call.name === "get_user_agent_changes")
      .map((call) => call.args),
    [
      { task_id: "one", scope: "task" },
      { task_id: "one", scope: "task", cursor: "1" },
    ],
  );

  assert.ok(screen.getByText("+1 −1, 2 files"));
  assert.ok(screen.getByText("Binary file changed · 2.0 KB"));
  assert.ok(screen.getByText("git diff abc123...agent/one"));
  assert.ok(screen.getByText("git push -u origin agent/one"));
  assert.ok(screen.getByText("cd /data/worktrees/one"));
  // One turn so far: the whole task is the only scope.
  assertAbsent(screen.queryByRole("group", { name: "Changes to show" }));

  await user.click(screen.getByRole("tab", { name: "Details" }));
  assert.ok(screen.getByText("agent/one"));
  assert.ok(screen.getAllByText("+1 −1, 2 files").length);
});

test("the Changes tab offers This turn after a second turn and explains empty states", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) => {
    transport.tasks = [{ ...task(), attempt: 2, branch: "agent/one" }];
  });

  await user.click(screen.getByRole("tab", { name: "Changes" }));
  await screen.findByText("No changes.");
  transport.changes = [{ ...transport.changes[0], scope: "turn" }];
  await user.click(screen.getByRole("button", { name: "This turn" }));
  await screen.findByText("No changes in this turn.");
  assert.equal(transport.calls.at(-1)?.args.scope, "turn");

  // A removed worktree names the branch and how to check it out.
  transport.changes = [
    {
      ...transport.changes[0],
      state: "workspace_missing",
      branch: "agent/one",
    },
  ];

  await user.click(screen.getByRole("button", { name: "Refresh changes" }));
  await screen.findByText(/The worktree was removed/);
  assert.ok(screen.getByText("git checkout agent/one"));

  // A finished turn reloads them; an error replaces them.
  const tool = transport.tool.bind(transport);

  transport.tool = async <T>(name: string, args?: Record<string, unknown>) => {
    if (name === "get_user_agent_changes")
      throw new Error("This task predates change tracking.");

    return tool<T>(name, args);
  };

  transport.tasks = [{ ...transport.tasks[0], status: "completed" }];
  await act(() => controller.refresh());
  await screen.findByText("This task predates change tracking.");
});

test("Preview opens a changed file, and the host can be asked about it", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.host.canShare = true;
    transport.changes = changePages("data.bin");

    transport.changedFiles = {
      "src/a.ts": {
        path: "src/a.ts",
        state: "present",
        size: 9,
        encoding: "utf8",
        content: "new line\n",
      },
    };
  });

  await user.click(screen.getByRole("tab", { name: "Changes" }));
  // A binary file that isn't an image has no preview.
  await screen.findByRole("button", { name: "Preview src/a.ts" });
  assertAbsent(screen.queryByRole("button", { name: "Preview data.bin" }));
  // Opening a preview leaves the file's section as it was.
  const section = document.querySelector(".diff-file") as HTMLDetailsElement;
  await user.click(screen.getByRole("button", { name: "Preview src/a.ts" }));
  assert.equal(section.open, true);
  const dialog = await screen.findByRole("dialog", { name: "src/a.ts" });

  await waitFor(() =>
    assert.match(
      dialog.querySelector(".code-view")?.textContent ?? "",
      /new line/,
    ),
  );

  await user.click(
    within(dialog).getByRole("button", { name: "Ask Codex about this file" }),
  );

  await within(dialog).findByRole("button", { name: "Shared with Codex" });

  assert.deepEqual(transport.shared.at(-1)?.selected_item, {
    kind: "file",
    path: "src/a.ts",
  });
});

test("previews say when a file was deleted, is binary, or can't be read", async (t) => {
  const { controller, transport } = await setup(t);
  const task = controller.getSnapshot().tasks[0];

  transport.changedFiles = {
    "gone.ts": { path: "gone.ts", state: "deleted", size: 0 },
    "data.bin": { path: "data.bin", state: "binary", size: 2048 },
  };

  for (const [path, text] of [
    ["gone.ts", "Deleted"],
    ["data.bin", "Binary file changed · 2.0 KB"],
    ["missing.ts", "The service returned no file."],
  ]) {
    if (path === "missing.ts") {
      const tool = transport.tool.bind(transport);

      transport.tool = async <T>(
        name: string,
        args?: Record<string, unknown>,
      ) => {
        if (name === "get_user_agent_changed_file")
          throw new Error("The service returned no file.");

        return tool<T>(name, args);
      };
    }

    act(() => controller.open({ kind: "file", task, path }));
    const dialog = await screen.findByRole("dialog", { name: path });
    await within(dialog).findByText(text);
    act(() => controller.dismiss());
    await waitFor(() => assertAbsent(screen.queryByRole("dialog")));
  }
});

test("worktree actions remove the worktree, confirming uncommitted changes, then delete the branch", async (t) => {
  const removals: Record<string, unknown>[] = [];

  const { controller, transport, user } = await setup(t, (transport) => {
    transport.tasks = [{ ...task(), status: "running", branch: "agent/one" }];
    const tool = transport.tool.bind(transport);

    transport.tool = async <T>(
      name: string,
      args?: Record<string, unknown>,
    ) => {
      if (name === "remove_user_agent_worktree") {
        transport.calls.push({ name, args: args ?? {} });
        removals.push(args ?? {});

        if (!args?.force)
          return { status: "uncommitted", files: ["draft.txt"] } as T;

        transport.changes = [
          {
            ...transport.changes[0],
            state: "workspace_missing",
            branch: "agent/one",
          },
        ];

        return { status: "removed" } as T;
      }

      if (name === "delete_user_agent_branch") {
        transport.calls.push({ name, args: args ?? {} });

        transport.changes = [
          {
            ...transport.changes[0],
            state: "branch_deleted",
            branch: "agent/one",
          },
        ];

        return { status: "deleted" } as T;
      }

      return tool<T>(name, args);
    };
  });

  await user.click(screen.getByRole("tab", { name: "Changes" }));
  const remove = await screen.findByRole("button", { name: "Remove worktree" });
  // A running task is using its worktree.
  assert.equal((remove as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByText("Available once the task stops."));

  transport.tasks = [{ ...transport.tasks[0], status: "interrupted" }];
  await act(() => controller.refresh());

  await waitFor(() =>
    assert.equal((remove as HTMLButtonElement).disabled, false),
  );

  await user.click(remove);

  // Uncommitted changes are listed before anything is discarded.
  const dialog = await screen.findByRole("dialog", {
    name: "Remove worktree?",
  });

  assert.ok(within(dialog).getByText("draft.txt"));

  await user.click(
    within(dialog).getByRole("button", { name: "Discard changes and remove" }),
  );

  await screen.findByText(/The worktree was removed/);

  assert.deepEqual(removals, [
    { task_id: "one" },
    { task_id: "one", force: true },
  ]);

  await user.click(screen.getByRole("button", { name: "Delete branch" }));
  const confirm = await screen.findByRole("dialog", { name: "Delete branch?" });

  await user.click(
    within(confirm).getByRole("button", { name: "Delete branch" }),
  );

  await screen.findByText(/were deleted/);

  assertAbsent(
    screen.queryByRole("button", { name: /Delete branch|Remove worktree/ }),
  );
});

test("a current_repo task's changes say they include edits made outside the task", async (t) => {
  const { user } = await setup(t, (transport) => {
    transport.tasks = [{ ...task(), workspace_strategy: "current_repo" }];
  });

  await user.click(screen.getByRole("tab", { name: "Changes" }));

  assert.ok(
    await screen.findByText(/since the task started.*outside the task/),
  );

  assertAbsent(screen.queryByText(/git push/));
});

test("a current_repo task's changes say they end with its latest turn once it ends", async (t) => {
  const { user } = await setup(t, (transport) => {
    transport.tasks = [
      {
        ...task(),
        workspace_strategy: "current_repo",
        end_tree: "a".repeat(40),
      },
    ];
  });

  await user.click(screen.getByRole("tab", { name: "Changes" }));

  assert.ok(
    await screen.findByText(/to the end of its latest turn.*outside the task/),
  );
});

test("dialog focuses task, preserves the draft and field node during refresh, and restores trigger focus", async (t) => {
  const { controller, transport, user } = await setup(t);
  const trigger = screen.getByRole("button", { name: "New Task" });
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
  await user.click(screen.getByRole("button", { name: "New Task" }));
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

  await user.click(screen.getByRole("button", { name: "New Task" }));
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

  // A new question opens expanded, with its choices inline rather than in a dialog.
  const toggle = screen.getByRole("button", { name: /Claude has a question/ });
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assertAbsent(screen.queryByRole("dialog"));
  await user.click(screen.getByRole("radio", { name: "Preset" }));

  await user.type(
    screen.getByLabelText("Write your own answer"),
    "Custom approach",
  );

  // A typed answer replaces the single choice.
  assert.equal(
    (screen.getByRole("radio", { name: "Preset" }) as HTMLInputElement).checked,
    false,
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

  await waitFor(() =>
    assert.ok(
      document.activeElement === screen.getByLabelText("Message (optional)"),
      "Permission dialog should focus its message field",
    ),
  );

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

  await waitFor(() =>
    assert.ok(
      document.activeElement === screen.getByLabelText("Message"),
      "Handoff dialog should focus its message field",
    ),
  );

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
      return this.matches(".notice-text:not([data-open])") ? 80 : 0;
    },
  );

  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.matches(".notice-text") ? 36 : 0;
    },
  );

  const { user } = await setup(t, (transport) => {
    transport.tasks[0].error = "Worker stopped unexpectedly. ".repeat(20);
  });

  // Task errors use the error tone.
  assert.equal(
    document
      .querySelector(".notice-text")
      ?.closest(".notice")
      ?.getAttribute("data-tone"),
    "error",
  );

  const more = screen.getByRole("button", { name: "Show more" });
  assert.equal(more.getAttribute("aria-expanded"), "false");
  await user.click(more);
  const less = screen.getByRole("button", { name: "Show less" });
  assert.equal(less.getAttribute("aria-expanded"), "true");
  assert.ok(document.querySelector(".notice-text[data-open]"));
  await user.click(less);
  assert.ok(screen.getByRole("button", { name: "Show more" }));
  assertAbsent(document.querySelector(".notice-text[data-open]"));
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
  layoutExpandableNotice(true);

  const { controller, user } = await setup(t);
  const detail = screen.getByRole("region", { name: "Task inspector" });
  const disclosure = descriptionToggle(document.body);
  const root = disclosure.closest(".notice-collapsible");
  await user.click(disclosure);
  assert.equal(disclosure.getAttribute("aria-expanded"), "true");
  detail.scrollTop = 160;
  await act(() => controller.refresh());
  assert.ok(descriptionToggle(document.body) === disclosure);
  assert.ok(disclosure.closest(".notice-collapsible") === root);
  assert.equal(disclosure.getAttribute("aria-expanded"), "true");
  assert.equal(detail.scrollTop, 160);
  await user.click(screen.getByRole("button", { name: "← Tasks" }));
  await act(() => controller.refresh());
  assert.equal(controller.getSnapshot().selected, undefined);

  assert.ok(
    document.querySelector('[data-tone="plain"] .notice-trigger') === null,
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
  await user.click(screen.getByRole("button", { name: "New Task" }));
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

  await user.click(screen.getByRole("button", { name: "New Task" }));
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

  await user.click(screen.getByRole("button", { name: "New Task" }));
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

  // Only the front card of the stack is exposed; the next one waits behind it.
  assert.ok(screen.getByText("Question 1 of 2"));
  assertAbsent(screen.queryByRole("group", { name: "Which scope?" }));
  await user.click(screen.getByRole("checkbox", { name: "Types" }));
  await user.click(screen.getByRole("checkbox", { name: "Tests" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  assert.ok(screen.getByText("Question 2 of 2"));
  await user.click(screen.getByRole("button", { name: "Back" }));
  assert.ok(screen.getByText("Question 1 of 2"));

  // Moving between cards keeps the answers already chosen.
  assert.equal(
    (screen.getByRole("checkbox", { name: "Tests" }) as HTMLInputElement)
      .checked,
    true,
  );

  await user.click(screen.getByRole("button", { name: "Next" }));
  assertAbsent(screen.queryByRole("group", { name: "Which checks?" }));
  await user.click(screen.getByRole("radio", { name: "Default scope" }));

  await user.type(
    screen.getByRole("textbox", { name: "Write your own answer" }),
    "Expanded scope",
  );

  await user.click(screen.getByRole("button", { name: "Send answers" }));

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

test("a single worker question can be skipped and the skip undone", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      input: {
        questions: [
          { question: "Which format?", options: [{ label: "YAML" }] },
        ],
      },
    };
  });

  await user.click(screen.getByRole("button", { name: "Skip this question" }));
  assert.ok(screen.getByText("Skipped", { selector: "[role=status]" }));
  await user.click(screen.getByRole("button", { name: "Undo" }));
  assert.ok(screen.getByRole("button", { name: "Skip this question" }));
  await user.click(screen.getByRole("button", { name: "Skip this question" }));
  await user.click(screen.getByRole("button", { name: "Send answer" }));

  await waitFor(() =>
    assert.deepEqual(
      transport.calls.find((call) => call.name === "submit_agent_input")?.args,
      {
        task_id: "one",
        request_id: "request",
        approved: true,
        input: {
          questions: [
            { question: "Which format?", options: [{ label: "YAML" }] },
          ],
          answers: { "Which format?": SKIPPED_ANSWER },
        },
      },
    ),
  );
});

test("a skipped stacked question sends an explicit skipped answer", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      input: {
        questions: [
          {
            question: "Which format?",
            header: "Format",
            options: [{ label: "YAML" }, { label: "JSON" }],
          },
          {
            question: "Which scope?",
            header: "Scope",
            options: [{ label: "All" }, { label: "Changed" }],
          },
        ],
      },
    };
  });

  await user.click(screen.getByRole("radio", { name: "YAML" }));
  // Skipping drops the partial answer and moves to the next card.
  await user.click(screen.getByRole("button", { name: "Skip this question" }));
  assert.ok(screen.getByText("Question 2 of 2"));

  assert.ok(
    screen.getByRole("button", { name: "Format" }).hasAttribute("data-skipped"),
  );

  await user.click(screen.getByRole("button", { name: "Format" }));

  assert.equal(
    (screen.getByRole("radio", { name: "YAML" }) as HTMLInputElement).checked,
    false,
  );

  // Picking a choice takes the skip back; Undo restores the card too.
  await user.click(screen.getByRole("radio", { name: "JSON" }));
  assertAbsent(screen.queryByText("Skipped", { selector: "[role=status]" }));
  await user.click(screen.getByRole("button", { name: "Skip this question" }));
  await user.click(screen.getByRole("radio", { name: "Changed" }));
  await user.click(screen.getByRole("button", { name: "Send answers" }));

  await waitFor(() =>
    assert.deepEqual(
      (
        transport.calls.find((call) => call.name === "submit_agent_input")?.args
          .input as any
      )?.answers,
      { "Which format?": SKIPPED_ANSWER, "Which scope?": "Changed" },
    ),
  );
});

test("a free-text worker question answers in a text box and shows send failures inline", async (t) => {
  const { transport, user } = await setup(t, (transport) => {
    // Codex workers ask one free-text question rather than a questions list.
    transport.tasks[0].pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      input: { question: "Which branch?" },
    };

    const original = transport.tool.bind(transport);
    let failures = 1;

    transport.tool = async <T>(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<T> => {
      if (name === "submit_agent_input" && failures-- > 0) {
        transport.calls.push({ name, args });
        throw new Error("Input request is stale");
      }

      return original<T>(name, args);
    };
  });

  await user.type(
    screen.getByRole("textbox", { name: "Which branch?" }),
    "main",
  );

  await user.click(screen.getByRole("button", { name: "Send answer" }));
  // The failure stays beside the answer, which is kept for a retry.
  await screen.findByText("Input request is stale");
  await user.click(screen.getByRole("button", { name: "Send answer" }));

  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "submit_agent_input")
        .length,
      2,
    ),
  );

  assert.deepEqual(
    transport.calls.findLast((call) => call.name === "submit_agent_input")?.args
      .input,
    { question: "Which branch?", answers: { "Which branch?": "main" } },
  );
});

test("unsent question answers survive switching tasks and clear once sent", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      input: {
        questions: [
          {
            question: "Which checks?",
            header: "Checks",
            multiSelect: true,
            options: [{ label: "Types" }, { label: "Tests" }],
          },
          {
            question: "Which scope?",
            header: "Scope",
            options: [{ label: "All" }],
          },
          {
            question: "Which owner?",
            header: "Owner",
            options: [{ label: "Me" }],
          },
        ],
      },
    };

    // Like the service, answering resolves the request, so the form unmounts.
    const original = transport.tool.bind(transport);

    transport.tool = async <T>(
      name: string,
      args: Record<string, unknown> = {},
    ): Promise<T> => {
      if (name === "submit_agent_input")
        transport.tasks[0] = {
          ...transport.tasks[0],
          pending_input: undefined,
        };

      return original<T>(name, args);
    };
  });

  await user.click(screen.getByRole("checkbox", { name: "Tests" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Skip this question" }));

  await user.type(
    screen.getByRole("textbox", { name: "Write your own answer" }),
    "Platform team",
  );

  const reopen = async () => {
    controller.back();

    await waitFor(() =>
      assertAbsent(screen.queryByRole("button", { name: /Claude has/ })),
    );

    await controller.select("one");
    await screen.findByText(/Question \d of 3/);
  };

  await reopen();
  // The same card, choices, typed answer and skip come back.
  assert.ok(screen.getByText("Question 3 of 3"));

  assert.equal(
    (
      screen.getByRole("textbox", {
        name: "Write your own answer",
      }) as HTMLInputElement
    ).value,
    "Platform team",
  );

  assert.ok(
    screen.getByRole("button", { name: "Scope" }).hasAttribute("data-skipped"),
  );

  await user.click(screen.getByRole("button", { name: "Checks" }));

  assert.equal(
    (screen.getByRole("checkbox", { name: "Tests" }) as HTMLInputElement)
      .checked,
    true,
  );

  await user.click(screen.getByRole("button", { name: "Send answers" }));

  await waitFor(() =>
    assert.deepEqual(
      (
        transport.calls.find((call) => call.name === "submit_agent_input")?.args
          .input as any
      )?.answers,
      {
        "Which checks?": "Tests",
        "Which scope?": SKIPPED_ANSWER,
        "Which owner?": "Platform team",
      },
    ),
  );

  // An answered request leaves no draft, even though the form unmounts afterwards.
  await waitFor(() =>
    assertAbsent(screen.queryByRole("button", { name: /Claude has/ })),
  );

  assert.equal(controller.questionDrafts.size, 0);
});

test("keyboard focus follows the stacked question cards", async (t) => {
  const { user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      input: {
        questions: [
          { question: "Which format?", options: [{ label: "YAML" }] },
          { question: "Which scope?", options: [{ label: "All" }] },
        ],
      },
    };
  });

  // Enter in a typed answer moves on and continues in the next card.
  await user.type(
    screen.getByRole("textbox", { name: "Write your own answer" }),
    "TOML{Enter}",
  );

  assert.ok(screen.getByText("Question 2 of 2"));

  assert.equal(
    document.activeElement,
    screen.getByRole("radio", { name: "All" }),
  );

  // Skip and Undo are one button, so focus stays put while it toggles.
  const toggle = screen.getByRole("button", { name: "Skip this question" });
  await user.click(toggle);
  assert.equal(toggle.textContent, "Undo");
  assert.equal(document.activeElement, toggle);
  // Back disappears on the first card, so focus moves to the send button.
  await user.click(screen.getByRole("button", { name: "Back" }));

  assert.equal(
    document.activeElement,
    screen.getByRole("button", { name: "Send answers" }),
  );
});

test("stacked worker questions return to the first unanswered card before sending", async (t) => {
  const { controller, transport, user } = await setup(t, (transport) => {
    transport.tasks[0].pending_input = {
      id: "request",
      tool: "AskUserQuestion",
      input: {
        questions: [
          {
            question: "Which format?",
            header: "Format",
            options: [{ label: "YAML" }, { label: "JSON" }],
          },
          {
            question: "Which extras?",
            header: "Extras",
            multiSelect: true,
            options: [{ label: "Docs" }, { label: "Tests" }],
          },
        ],
      },
    };
  });

  // Headers summarize stacked questions; clicking the summary collapses the notice.
  await user.click(screen.getByText("Format · Extras"));

  const toggle = () =>
    screen.getByRole("button", { name: /Claude has 2 questions/ });

  assert.equal(toggle().getAttribute("aria-expanded"), "false");
  // A collapsed question stays collapsed when its task is shown again.
  controller.back();

  await waitFor(() =>
    assertAbsent(screen.queryByRole("button", { name: /Claude has/ })),
  );

  await controller.select("one");

  await waitFor(() =>
    assert.equal(toggle().getAttribute("aria-expanded"), "false"),
  );

  await user.click(toggle());
  await user.click(screen.getByRole("button", { name: "Extras" }));
  assert.ok(screen.getByText("Question 2 of 2"));
  await user.click(screen.getByRole("checkbox", { name: "Docs" }));

  // A typed answer joins the multiple choices.
  await user.type(
    screen.getByRole("textbox", { name: "Write your own answer" }),
    "Examples",
  );

  await user.click(screen.getByRole("button", { name: "Send answers" }));

  assert.equal(
    screen
      .getByText("Answer each question before sending.")
      .getAttribute("role"),
    "alert",
  );

  assert.ok(screen.getByText("Question 1 of 2"));

  assert.equal(
    transport.calls.filter((call) => call.name === "submit_agent_input").length,
    0,
  );

  await user.click(screen.getByRole("radio", { name: "JSON" }));
  await user.click(screen.getByRole("button", { name: "Send answers" }));

  await waitFor(() =>
    assert.deepEqual(
      (
        transport.calls.find((call) => call.name === "submit_agent_input")?.args
          .input as any
      )?.answers,
      { "Which format?": "JSON", "Which extras?": "Docs, Examples" },
    ),
  );
});

test("zero runtime and cost budgets cannot launch a task", async (t) => {
  const { transport, user } = await setup(t);
  await user.click(screen.getByRole("button", { name: "New Task" }));
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
  await user.click(screen.getByRole("button", { name: "New Task" }));
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
  await user.click(screen.getByRole("button", { name: "New Task" }));
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
    {},
  );

  act(() => {
    void controller.addProject();
  });

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
  const { controller, transport, user } = await setup(
    t,
    (transport) =>
      configureProjectRegistration(transport, { picked: "/repo/picked" }),
    {},
  );

  act(() => {
    void controller.addProject();
  });

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

test("the panel's Browse button picks a folder and adds it without the project dialog", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureProjectRegistration(transport, { picked: "/repo/picked" }),
  );

  await user.click(screen.getByRole("button", { name: "Browse" }));

  await waitFor(() =>
    assert.deepEqual(
      transport.calls
        .filter((call) => call.name === "register_user_agent_project")
        .map((call) => call.args),
      [{ repository: "/repo/picked" }],
    ),
  );

  assertAbsent(screen.queryByRole("dialog"));
});

test("cancelling the panel's folder picker adds nothing", async (t) => {
  const { transport, user } = await setup(t, (transport) =>
    configureProjectRegistration(transport),
  );

  await user.click(screen.getByRole("button", { name: "Browse" }));

  await waitFor(() =>
    assert.ok(
      transport.calls.some((call) => call.name === "browse_user_agent_project"),
    ),
  );

  assert.equal(
    transport.calls.filter(
      (call) => call.name === "register_user_agent_project",
    ).length,
    0,
  );

  assertAbsent(screen.queryByRole("dialog"));
});

test("cancelling the native picker preserves the manual project path", async (t) => {
  const { controller, transport, user } = await setup(
    t,
    (transport) => configureProjectRegistration(transport),
    {},
  );

  act(() => {
    void controller.addProject();
  });

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
    {},
  );

  act(() => {
    void controller.addProject();
  });

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

  await user.click(screen.getByText("Close", { selector: "footer button" }));
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
  const { controller, transport, user } = await setup(
    t,
    (transport) =>
      configureProjectRegistration(transport, {
        browseError: "Native folder picker unavailable",
      }),
    {},
  );

  act(() => {
    void controller.addProject();
  });

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
    {},
  );

  act(() => {
    void controller.addProject();
  });

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

  act(() => {
    void controller.addProject();
  });

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

  await user.click(screen.getByRole("button", { name: "New Task" }));
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

  await user.click(screen.getByRole("button", { name: "New Task" }));
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

  await user.click(screen.getByRole("button", { name: "New Task" }));
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

  await user.click(screen.getByRole("button", { name: "New Task" }));
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

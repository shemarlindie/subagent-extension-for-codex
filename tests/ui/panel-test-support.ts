// @vitest-environment jsdom
import assert from "node:assert/strict";

import { describe, expect, test, type TestContext, vi } from "vitest";

import { defaults } from "../../src/panel/app/state/controller-test-harness";
import type {
  HostState,
  Project,
  SettingsDocument,
  Task,
  Transport,
  TransportEvents,
} from "../../src/panel/app/state/types";
import type {
  ChangedFileContent,
  Changes,
} from "../../src/panel/features/changes/types";
import { decodePanelToolResult } from "../../src/panel/transports/event-decoding.js";
import { changeCounts } from "../../src/shared/changes/changes.js";
import type { Event } from "../../src/shared/events/types.js";
import { withSetting } from "../../src/shared/settings/settings-schema.js";
import {
  windowActivity,
  windowTurnActivity,
} from "../../src/shared/tasks/activity/activity-tail.js";
import type { PendingTaskUpdates } from "../../src/shared/tasks/conversation/parent-updates.js";

// UI primitives read browser capabilities at module initialization.
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

// jsdom has no layout or native scrolling.
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value() {},
});

if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () =>
      ({
        matches: false,
        media: "",
        onchange: null,
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- MediaQueryList still requires this legacy member.
        addListener() {},
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- MediaQueryList still requires this legacy member.
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      }) as MediaQueryList,
  });
}

if (typeof window.ResizeObserver !== "function") {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: class {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element) {
        const contentRect = target.getBoundingClientRect();

        const size = {
          inlineSize: contentRect.width,
          blockSize: contentRect.height,
        };

        const entry = {
          target,
          contentRect,
          borderBoxSize: [size],
          contentBoxSize: [size],
          devicePixelContentBoxSize: [size],
        } as ResizeObserverEntry;

        this.callback([entry], this);
      }

      unobserve(_target: Element) {}
      disconnect() {}
    },
  });
}

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, Fragment } from "react";

import { AppShell } from "../../src/panel/app/app-shell";
import { Controller } from "../../src/panel/app/state/controller";
import { ControllerContext } from "../../src/panel/app/state/controller-context";
import { ProjectsPage } from "../../src/panel/features/projects/projects-page";
import { SettingsPage } from "../../src/panel/features/settings/settings-page";
import { SKIPPED_ANSWER } from "../../src/panel/features/tasks/controls/question-answers";
import { TaskInspector } from "../../src/panel/features/tasks/inspector/task-inspector";
import { TaskFilters } from "../../src/panel/features/tasks/list/task-filters";
import { TaskList } from "../../src/panel/features/tasks/list/task-list";
import { DialogHost } from "../../src/panel/shared/dialogs/dialog-host";

// assert.equal(element, null) diffs the whole jsdom object graph on failure,
// which never finishes and starves waitFor's timeout.
export function assertAbsent(element: Element | null) {
  expect(element).toBeNull();
}

export function task(id = "one", repository = "/repo/a"): Task {
  return {
    id,
    repository,
    revision: "feature",
    provider: "claude",
    worker_profile: "reviewer",
    title: "Review authentication",
    description: "Review authentication and report relevant findings.",
    depends_on: [],
    workspace_strategy: "worktree",
    budget: { max_runtime_minutes: 20, max_cost_usd: null },
    owner: "owner",
    status: "running",
    created_at: "",
    updated_at: "",
    created_by: "user",
    instructions_sent: 0,
    pending_steers: [],
    queue: [],
    turn: 1,
    runtime_ms: 0,
  };
}

export async function startedTask(transport: FakeTransport) {
  await waitFor(() =>
    assert.equal(
      transport.calls.filter((call) => call.name === "start_task").length,
      1,
    ),
  );

  return transport.calls.find((call) => call.name === "start_task")!;
}

export class FakeTransport implements Transport {
  embedded = true;
  events!: TransportEvents;
  tasks = [task()];
  /** The events app_get_activity windows and tallies. */
  taskEvents: Record<string, unknown>[] = [];
  /** app_get_chat items. */
  chat: Record<string, unknown>[] = [];
  projects: Project[] = [{ repository: "/repo/a", kind: "repository" }];
  calls: { name: string; args: Record<string, unknown> }[] = [];
  /**
   * get_changes pages; a cursor is the next page's index. The
   * first page also answers app_get_change_counts, so one is required.
   */
  changes: [Changes, ...Changes[]] = [
    { scope: "task", files: [], additions: 0, deletions: 0, diff: "" },
  ];

  /** get_changed_file results by path. */
  changedFiles: Record<string, ChangedFileContent> = {};
  shared: Record<string, unknown>[] = [];
  messages: string[] = [];
  /** app_list_pending_updates tasks. */
  pendingUpdates: PendingTaskUpdates[] = [];
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

  async saveJson() {
    return false;
  }

  async expand() {
    this.expandCalls++;
    this.setDisplayMode("fullscreen");
  }

  /** Changes the display mode, as the host does on its own. */
  setDisplayMode(displayMode: HostState["displayMode"]) {
    this.host = { ...this.host, displayMode };
    this.events.host(this.host);
  }

  async tool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ name, args });

    // Activity fixtures can be large. Decode and window them only for reads
    // that request activity, as the service does.
    if (name === "app_get_activity" || name === "app_get_turn_activity") {
      const events = decodePanelToolResult<{ events: Event[] }>(name, {
        events: this.taskEvents,
      }).events;

      return decodePanelToolResult<T>(
        name,
        name === "app_get_activity"
          ? windowActivity(events, Number(args.after ?? 0))
          : windowTurnActivity(events, Number(args.turn)),
      );
    }

    const values: Record<string, unknown> = {
      get_panel_context: { panel_scope: { conversation_id: null } },
      list_projects: this.projects,
      list_workers: [
        {
          provider: "claude",
          profiles: ["reviewer"],
          capabilities: { cost_budget: true },
        },
        {
          provider: "fixture",
          profiles: ["reviewer"],
          capabilities: { cost_budget: false },
        },
      ],
      app_list_tasks: { tasks: this.tasks },
      app_get_chat: { items: this.chat, next_cursor: 0 },
      app_get_change_counts: changeCounts(this.changes[0]),
      get_changes: this.changes[Number(args.cursor ?? 0)],
      get_changed_file: this.changedFiles[String(args.path)],
      get_settings: { values: defaults },
      start_task: this.tasks[0],
      submit_input: {},
      app_list_pending_updates: { tasks: this.pendingUpdates },
    };

    assert.ok(name in values, `Unexpected tool ${name}`);

    return decodePanelToolResult<T>(name, values[name]);
  }

  async send(message: string) {
    this.messages.push(message);
  }

  watch() {}
  dispose() {}
}

export function configureProjectRegistration(
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
    if (name === "app_browse_project") {
      transport.calls.push({ name, args });
      if (options.browseError) throw new Error(options.browseError);

      return { repository: options.picked ?? null } as T;
    }

    if (name === "app_register_project") {
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

export async function setup(
  t: TestContext,
  configure?: (transport: FakeTransport) => void,
  options: {
    wide?: boolean;
    scoped?: boolean;
    conversation?: string;
    displayMode?: HostState["displayMode"];
    start?: boolean;
    view?:
      | "settings"
      | "delegate"
      | "dialogs"
      | "projects"
      | "inspector"
      | "task-list";
  } = {},
) {
  const transport = new FakeTransport();

  if (options.displayMode) transport.host.displayMode = options.displayMode;
  configure?.(transport);

  if (options.conversation) {
    transport.tasks = transport.tasks.map((task) => ({
      ...task,
      conversation_id: options.conversation,
    }));
  }

  const controller = new Controller(transport, {
    hidden: () => false,
    wide: () => options.wide ?? true,
  });

  const restorePanelGeometry = mockPanelGeometry();

  t.onTestFinished(() => {
    cleanup();
    controller.dispose();
    restorePanelGeometry();
  });

  if (options.scoped || options.conversation) {
    controller.applyScope(
      {
        panel_scope: {
          conversation_id: options.conversation ?? null,
          repository: "/repo/a",
        },
      },
      false,
    );
  }

  if (options.start !== false) await controller.start();
  if (options.view === "settings") await controller.settings();
  if (options.view === "delegate") await controller.delegate();
  if (options.view === "projects") controller.manageProjects();

  const views = {
    settings: SettingsPage,
    delegate: DialogHost,
    dialogs: DialogHost,
    projects: ProjectsHarness,
    inspector: InspectorHarness,
    "task-list": TaskListHarness,
  };

  function Harness() {
    return createElement(
      ControllerContext.Provider,
      { value: controller },
      createElement(options.view ? views[options.view] : AppShell),
    );
  }

  await act(async () => {
    render(createElement(Harness));
  });

  // Tests await each action, so keystrokes need no macrotask between them.
  const user = userEvent.setup({ document: document, delay: null });

  if (options.view === "settings") {
    await waitFor(() =>
      expect(controller.getSnapshot().dialog?.kind).toBe("settings"),
    );
  }

  return { controller, transport, user };
}

function ProjectsHarness() {
  return createElement(
    Fragment,
    null,
    createElement(ProjectsPage),
    createElement(DialogHost),
  );
}

function InspectorHarness() {
  return createElement(
    Fragment,
    null,
    createElement(TaskInspector),
    createElement(DialogHost),
  );
}

function TaskListHarness() {
  return createElement(
    Fragment,
    null,
    createElement(TaskFilters),
    createElement(TaskList),
  );
}

function mockPanelGeometry() {
  const offsetWidth = vi
    .spyOn(HTMLElement.prototype, "offsetWidth", "get")
    .mockImplementation(function (this: HTMLElement) {
      if (this.id === "task-rail-panel") return 245;
      if (this.id === "task-inspector-panel") return 755;

      return this.hasAttribute("data-separator") ? 4 : 0;
    });

  const clientWidth = vi
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-group") ? 1004 : this.offsetWidth;
    });

  const getBoundingClientRect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-group")) return new DOMRect(0, 0, 1004, 600);
      if (this.id === "task-rail-panel") return new DOMRect(0, 0, 245, 600);

      if (this.hasAttribute("data-separator")) {
        return new DOMRect(245, 0, 4, 600);
      }

      if (this.id === "task-inspector-panel") {
        return new DOMRect(249, 0, 755, 600);
      }

      return new DOMRect(0, 0, 0, 0);
    });

  return () => {
    offsetWidth.mockRestore();
    clientWidth.mockRestore();
    getBoundingClientRect.mockRestore();
  };
}

export async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string | RegExp,
  multiple = false,
) {
  const trigger = screen.getByRole("combobox", { name: label });

  await waitFor(() =>
    assert.equal(
      (trigger as HTMLButtonElement | HTMLInputElement).disabled,
      false,
    ),
  );

  await user.click(trigger);
  await user.click(await screen.findByRole("option", { name: option }));
  if (multiple) await user.keyboard("{Escape}");

  await waitFor(() =>
    assert.equal(trigger.getAttribute("aria-expanded"), "false"),
  );
}

export async function openAdvancedTask(
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.click(
    screen.getByRole("button", { name: "More ways to start a task" }),
  );

  await user.click(
    await screen.findByRole("menuitem", { name: /Advanced task…/ }),
  );
}

export function selectedProjectPath() {
  const project = screen.getByRole("combobox", { name: "Project" });

  return project instanceof HTMLInputElement
    ? project.value
    : (project.querySelector(".select-value-description")?.textContent ?? "");
}

/** Fill incidental text with one input event. Keyboard tests use user.type. */
export async function pasteText(
  user: ReturnType<typeof userEvent.setup>,
  field: Element,
  text: string,
) {
  await user.click(field);
  await user.paste(text);
}

export async function enterTask(
  user: ReturnType<typeof userEvent.setup>,
  description: string,
) {
  await pasteText(user, screen.getByLabelText("Description"), description);
}

/** Page-local settings cases do not need the retained Tasks page. */
export function setupSettings(
  t: TestContext,
  configure: (transport: FakeTransport) => void,
) {
  return setup(t, configure, { view: "settings" });
}

/** Form-local cases keep the real modal without the unrelated Tasks page. */
export function setupDelegate(
  t: TestContext,
  configure?: (transport: FakeTransport) => void,
) {
  return setup(t, configure, { view: "delegate" });
}

/** Project-local cases keep their real dialogs without the retained Tasks page. */
export function setupProjects(
  t: TestContext,
  configure?: (transport: FakeTransport) => void,
) {
  return setup(t, configure, { view: "projects" });
}

/** Inspector-local cases retain evidence tabs, chat controls and real dialogs. */
export function setupInspector(
  t: TestContext,
  configure?: (transport: FakeTransport) => void,
) {
  return setup(t, configure, { view: "inspector" });
}

/** Serves saved settings with the given values, keyed by dotted path. */
export function configureModelDefaults(
  transport: FakeTransport,
  saved: Record<string, string>,
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

    if (name === "get_settings") {
      const values = Object.entries(saved).reduce(
        (merged, [path, value]) => withSetting(merged, path, value),
        result.values,
      );

      return { ...result, values } as T;
    }

    if (name === "list_workers") {
      return result.map((worker: any) => ({
        ...worker,
        profiles: ["reviewer", "researcher"],
        ...(models ? { models } : {}),
      })) as T;
    }

    return result as T;
  };
}

// Serves a settings document and records updates without applying them.
// Values and defaults hold only the settings the sections show.
export function serveSettings(
  transport: FakeTransport,
  document: Pick<SettingsDocument, "sections"> & {
    values?: Record<string, unknown>;
    defaults?: Record<string, unknown>;
  },
) {
  const original = transport.tool.bind(transport);

  transport.tool = async <T>(name: string, args = {}) => {
    if (name === "update_settings") {
      transport.calls.push({ name, args });

      return { values: {} } as T;
    }

    if (name === "get_settings") {
      return {
        schema: { type: "object", properties: {} },
        values: {},
        defaults: {},
        ...document,
      } as T;
    }

    return original<T>(name, args);
  };
}

const effortOptions = [
  { value: "default", label: "Inherit" },
  { value: "high", label: "high" },
];

// A model scope row at a settings path such as `models.global`. Without
// `options`, the model is typed.
export const scope = (
  path: string,
  label: string,
  options?: { value: string; label: string; description?: string }[],
) => ({
  id: path.split(".").at(-1)!,
  label,
  model: { path: `${path}.model`, label: `${label} model`, options },
  effort: {
    path: `${path}.reasoning_effort`,
    label: `${label} effort`,
    options: effortOptions,
    unsupported: false,
  },
});

export const budgetRow = {
  kind: "budget" as const,
  path: "task.budget.max_cost_usd",
  label: "Cost limit",
  unit: "USD",
  min: 0.01,
  max: 100,
};

export {
  act,
  assert,
  describe,
  screen,
  SKIPPED_ANSWER,
  test,
  vi,
  waitFor,
  within,
};

// Two pages of one file each, as the service pages a large diff. The second
// file is binary.
const changePages = (binary = "logo.png"): [Changes, ...Changes[]] => {
  const files: Changes["files"] = [
    {
      path: "src/a.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      source: "tool",
      incomplete: false,
    },
    {
      path: binary,
      status: "added",
      additions: 0,
      deletions: 0,
      source: "command",
      incomplete: true,
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

export { changePages };

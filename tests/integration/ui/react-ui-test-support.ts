// @vitest-environment jsdom
import assert from "node:assert/strict";

import { describe, expect, test, type TestContext, vi } from "vitest";

import type {
  HostState,
  Project,
  SettingsDocument,
  Task,
  Transport,
  TransportEvents,
} from "../../../src/panel/app/state/types";
import type {
  ChangedFileContent,
  Changes,
} from "../../../src/panel/features/changes/types";
import type { Event } from "../../../src/shared/events/types.js";
import {
  windowActivity,
  windowTurnActivity,
} from "../../../src/shared/tasks/activity/activity-tail.js";
import type { InputPresentation } from "../../../src/shared/tasks/model.js";
import { changeCounts } from "../../../src/shared/workspaces/changes.js";

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
        addListener() {},
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

        this.callback([entry], this as unknown as ResizeObserver);
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
import { createElement } from "react";

import { AppShell } from "../../../src/panel/app/app-shell";
import { Controller } from "../../../src/panel/app/state/controller";
import { ControllerContext } from "../../../src/panel/app/state/controller-context";
import { SKIPPED_ANSWER } from "../../../src/panel/features/tasks/controls/question-form";

export const executionPresentation: InputPresentation = {
  description:
    "Approval covers the entire execution turn, including shell commands.",
  approveLabel: "Approve this execution turn",
};

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

export class FakeTransport implements Transport {
  embedded = true;
  events!: TransportEvents;
  tasks = [task()];
  /** The events get_user_agent_activity windows and tallies. */
  taskEvents: Record<string, unknown>[] = [];
  /** get_user_agent_chat items. */
  chat: Record<string, unknown>[] = [];
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
          provider: "fixture",
          profiles: ["reviewer"],
          capabilities: { cost_budget: false },
        },
      ],
      list_agent_tasks: this.tasks,
      get_user_agent_activity: windowActivity(
        this.taskEvents as unknown as Event[],
        Number(args.after ?? 0),
      ),
      get_user_agent_turn_activity: windowTurnActivity(
        this.taskEvents as unknown as Event[],
        Number(args.turn),
      ),
      get_user_agent_chat: { items: this.chat, next_cursor: 0 },
      get_user_agent_change_counts: changeCounts(this.changes[0]),
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

export async function setup(
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

  const restorePanelGeometry = mockPanelGeometry();

  t.onTestFinished(() => {
    cleanup();
    controller.dispose();
    restorePanelGeometry();
  });

  render(createElement(Harness));

  const user = userEvent.setup({ document: document });

  return { controller, transport, user };
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
      if (this.hasAttribute("data-separator"))
        return new DOMRect(245, 0, 4, 600);
      if (this.id === "task-inspector-panel")
        return new DOMRect(249, 0, 755, 600);

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

export async function enterTask(user: any, description: string) {
  await user.type(screen.getByLabelText("Description"), description);
}

export function configureModelDefaults(
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
export function serveSettings(
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

export const effortOptions = [
  { value: "default", label: "Inherit" },
  { value: "high", label: "high" },
];

// A model scope row; without `options` the model is typed.
export const scope = (
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

export const budgetRow = {
  kind: "budget" as const,
  key: "max_cost_usd",
  toggle: "use_cost_budget",
  label: "Cost limit",
  unit: "USD",
  min: 0.01,
  max: 100,
  amount: 5,
};

export {
  act,
  AppShell,
  assert,
  cleanup,
  Controller,
  ControllerContext,
  createElement,
  describe,
  render,
  screen,
  SKIPPED_ANSWER,
  test,
  userEvent,
  vi,
  waitFor,
  within,
};

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

export { changePages };

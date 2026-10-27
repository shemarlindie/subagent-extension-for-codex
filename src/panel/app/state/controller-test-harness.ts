// Test-only Controller harness. The source-boundaries lint rule and the panel
// build reject production imports of `*-test-harness` modules.
import assert from "node:assert/strict";

import { settingsDefaults } from "../../../shared/settings/settings-schema";
import { decodePanelToolResult } from "../../transports/event-decoding";
import { Controller } from "./controller";
import type {
  Defaults,
  PanelData,
  Task,
  Transport,
  TransportEvents,
  UiStatePersistence,
} from "./types";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;

  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });

  return { promise, resolve, reject };
}

export const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

const initialDefaults = settingsDefaults("claude");

export const defaults: Defaults = {
  ...initialDefaults,
  task: {
    ...initialDefaults.task,
    budget: {
      ...initialDefaults.task.budget,
      max_runtime_minutes: { enabled: true, amount: 0.5 },
    },
  },
};

export function task(
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

export class FakeTransport implements Transport {
  embedded = true;
  send?: Transport["send"];
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

    if (answer !== undefined) {
      return decodePanelToolResult<T>(name, await Promise.resolve(answer));
    }

    // Without a handler, the update wait holds as if nothing changes.
    if (name === "app_wait_for_updates") return new Promise<T>(() => {});

    const values: Record<string, unknown> = {
      get_panel_context: this.context,
      list_projects: this.projects,
      list_workers: [
        { provider: "claude", profiles: ["reviewer"], capabilities: {} },
      ],
      list_tasks: this.tasks,
      app_get_activity: { events: [] },
      app_get_change_counts: {
        scope: "task",
        files: 0,
        additions: 0,
        deletions: 0,
      },
      app_get_chat: { items: [], next_cursor: 0 },
      get_message: { message: { id: "parent_1" } },
      get_settings: { values: defaults },
    };

    assert.ok(name in values, `Unexpected tool ${name}`);

    return decodePanelToolResult<T>(name, values[name]);
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

export function setup(wide = false) {
  const transport = new FakeTransport();

  const visibility = new Set<() => void>();

  const environment = {
    hidden: () => false,
    wide: () => wide,
    onVisibilityChange(listener: () => void) {
      visibility.add(listener);

      return () => visibility.delete(listener);
    },
    /** Shows or hides the panel and tells the controller, as the browser does. */
    setHidden(hidden: boolean) {
      environment.hidden = () => hidden;
      for (const listener of visibility) listener();
    },
  };

  const controller = new Controller(transport, environment);

  return { transport, controller, environment };
}

export function setupWithViewState(
  initial: UiStatePersistence["initial"],
  transport = new FakeTransport(),
) {
  const saved: UiStatePersistence["initial"][] = [];

  const controller = new Controller(
    transport,
    { hidden: () => false, wide: () => true },
    { initial, save: (state) => saved.push(state) },
  );

  return { transport, controller, saved };
}

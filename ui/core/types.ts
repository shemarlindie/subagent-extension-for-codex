import type {
  Artifact,
  Capabilities,
  Event,
  Task,
  ModelChoice,
} from "../../src/core/model";
export type { Artifact, Event, Task };
export type Mode = "panel" | "console";
export type Tab = "result" | "activity" | "changes";
export type Filter = "all" | "active" | "attention" | "completed";
export type Worker = {
  provider: string;
  profiles: string[];
  models?: ModelChoice[];
  model_discovery_error?: string;
  capabilities: Partial<Capabilities>;
};
export type Project = { repository: string; name?: string; kind: string };
export type Defaults = {
  default_model?: string;
  default_reasoning_effort?: string;
  [key: `${string}_default_model`]: string | undefined;
  [key: `${string}_default_reasoning_effort`]: string | undefined;
  default_workspace_strategy?: "worktree" | "current_repo";
  default_provider?: string;
  default_worker_profile?: string;
  max_runtime_minutes: number;
  max_cost_usd: number | null;
  use_cost_budget?: boolean;
};
export type SettingsDocument = {
  values: Record<string, string | number | boolean>;
  schema: {
    properties?: Record<
      string,
      {
        type: "string" | "number" | "integer" | "boolean";
        title?: string;
        description?: string;
        enum?: string[];
        maxLength?: number;
        minimum?: number;
        maximum?: number;
      }
    >;
    required?: string[];
  };
  layout?: {
    kind: string;
    title: string;
    items: { kind: string; property?: string }[];
  }[];
};
export type PanelData = {
  panel_scope?: {
    conversation_id: string | null;
    repository?: string;
    revision?: string;
  };
  panel_selection?: { task_id?: string; tab?: string };
  tasks?: Task[];
};
export type HostState = {
  canSend: boolean;
  canShare: boolean;
  canExpand: boolean;
  displayMode: "inline" | "fullscreen" | "pip";
};
export type TransportEvents = {
  scope(data: PanelData): void;
  refresh(): void;
  status(text: string): void;
  login(): void;
  host(state: HostState): void;
  teardown(): void;
};
export interface Transport {
  embedded: boolean;
  preview: boolean;
  connect(events: TransportEvents): Promise<void>;
  tool<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  watch(): void;
  dispose(): void;
  send?(message: string): Promise<void>;
  share?(data: Record<string, unknown>): Promise<void>;
  expand?(): Promise<void>;
  login?(token: string): Promise<void>;
}
export type Question = {
  question: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
};
export type DialogState =
  | { kind: "settings"; settings: SettingsDocument; scope: number }
  | {
      kind: "delegate";
      defaults: Defaults;
      preferredWorker?: string;
      repository?: string;
      revision: string;
      scope: number;
    }
  | { kind: "control"; action: string; task: Task; scope: number }
  | { kind: "respond"; task: Task; scope: number }
  | { kind: "handoff"; task: Task; scope: number }
  | { kind: "artifact"; artifact: Artifact; scope: number }
  | { kind: "workspace"; task: Task; scope: number };
export type Snapshot = {
  mode: Mode;
  tasks: Task[];
  workers: Worker[];
  projects: Project[];
  events: Event[];
  artifacts: Artifact[];
  selected?: string;
  selectedArtifact?: string;
  workerRoute?: string;
  conversation?: string;
  repository?: string;
  revision: string;
  filter: Filter;
  search: string;
  tab: Tab;
  connected: boolean;
  scopeKnown: boolean;
  busy: boolean;
  connection: string;
  error: string;
  loginRequired: boolean;
  dialog?: DialogState;
  formError: string;
  scopeVersion: number;
  host: HostState;
};

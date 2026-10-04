import type {
  Artifact,
  Capabilities,
  Event,
  ModelChoice,
} from "../../src/core/model";
import type { SettingSection } from "../../src/core/settings-document";
import type { ListedTask } from "../../src/core/task-list";
import type { DroppedSummary } from "./event-history";

export type Task = ListedTask;
export type { Artifact, Event };
export type Mode = "panel" | "console";
export type Tab = "result" | "activity" | "changes" | "details";
export type Filter = "all" | "active" | "attention" | "completed" | "failed";

export type Worker = {
  provider: string;
  profiles: string[];
  models?: ModelChoice[];
  model_discovery_error?: string;
  capabilities: Partial<Capabilities>;
};

export type Project = {
  repository: string;
  name?: string;
  kind: string;
  /** The chat's unregistered project, added when a task starts with it. */
  pending?: boolean;
};

export type Defaults = {
  claude_permission_mode?: import("../../src/core/model").Start["permission_mode"];
  default_approval_decider?: "user" | "parent_agent";
  default_approval_mode?: import("../../src/core/model").ApprovalMode;
  default_model?: string;
  default_reasoning_effort?: string;
  [key: `${string}_default_model`]: string | undefined;
  [key: `${string}_default_reasoning_effort`]: string | undefined;
  default_workspace_strategy?: "worktree" | "current_repo";
  default_provider?: string;
  default_worker_profile?: string;
  max_runtime_minutes: number | null;
  use_runtime_budget?: boolean;
  max_cost_usd: number | null;
  use_cost_budget?: boolean;
};

export type SettingValue = string | number | boolean | null;

/**
 * `get_agent_settings` as the dialog reads it: current values, the defaults a
 * reset restores, and the sections and rows to show. The JSON `schema` is for
 * agents; the dialog ignores it.
 */
export type SettingsDocument = {
  values: Record<string, SettingValue>;
  defaults: Record<string, SettingValue>;
  sections: SettingSection[];
};

export type PanelData = {
  panel_scope?: {
    conversation_id: string | null;
    repository?: string;
    revision?: string;
  };
  panel_project_candidate?: { repository: string; auto_register?: boolean };
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
  /** Short chip label (at most 12 characters in the Claude SDK schema). */
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
};

/** Question form values, indexed by question position. */
export type QuestionAnswers = {
  answers: Record<string, string | string[]>;
  custom: Record<string, string>;
};

/** Unsent answers to one question request, restored when its task is shown again. */
export type QuestionDraft = {
  values: QuestionAnswers;
  skipped: number[];
  active: number;
};

export type DialogState =
  | { kind: "project"; repository?: string; scope: number }
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
  /** Tally of the selected task's events that fell off the front of `events`. */
  droppedEvents?: DroppedSummary;
  artifacts: Artifact[];
  selected?: string;
  selectedArtifact?: string;
  workerRoute?: string;
  conversation?: string;
  repository?: string;
  projectCandidate?: string;
  projectCandidateAuto?: boolean;
  revision: string;
  // Null until the user picks one; the list then follows the first nonempty filter.
  filter: Filter | null;
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

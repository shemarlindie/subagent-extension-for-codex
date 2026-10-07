/* eslint-disable simple-import-sort/exports */

import type { Event } from "../../../src/features/events/types.js";
import type { HostState } from "../../adapters/transports/types.js";
import type { ChangesState } from "../../features/changes/types.js";
import type { Project } from "../../features/projects/types.js";
import type { Worker } from "../../features/providers/types.js";
import type {
  Defaults,
  SettingsDocument,
} from "../../features/settings/types.js";
import type { DroppedSummary } from "../../features/tasks/activity/event-history.js";
import type { Filter, Tab, Task } from "../../features/tasks/types.js";

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
  | {
      kind: "control";
      action: ControlAction;
      task: Task;
      scope: number;
    }
  | { kind: "respond"; task: Task; scope: number }
  | { kind: "handoff"; task: Task; scope: number }
  // Confirms deleting the task and everything related to it.
  | { kind: "delete"; task: Task; scope: number }
  // A file the task changed, previewed as it is now.
  | { kind: "file"; task: Task; path: string; scope: number }
  // Confirms removing a worktree with uncommitted `files`, or deleting a branch.
  | {
      kind: "worktree";
      action: "remove" | "delete-branch";
      task: Task;
      files?: string[];
      scope: number;
    };

export type ControlAction =
  "steer" | "continue" | "cancel" | "retry" | "interrupt";

/** Form edits are JSON-safe values keyed by each form's field names. */
export type PersistedDialogDraft = Record<string, unknown>;

/** Local dialog descriptors; server-owned task and settings data is reloaded. */
export type PersistedDialog =
  | {
      kind: "project";
      repository?: string;
      draft?: PersistedDialogDraft;
    }
  | { kind: "settings"; draft?: PersistedDialogDraft }
  | {
      kind: "delegate";
      preferredWorker?: string;
      repository?: string;
      revision?: string;
      draft?: PersistedDialogDraft;
    }
  | {
      kind: "control";
      action: ControlAction;
      taskId: string;
      draft?: PersistedDialogDraft;
    }
  | {
      kind: "respond";
      taskId: string;
      requestId?: string;
      draft?: PersistedDialogDraft;
    }
  | { kind: "handoff"; taskId: string; draft?: PersistedDialogDraft }
  | { kind: "delete"; taskId: string; draft?: PersistedDialogDraft }
  | {
      kind: "file";
      taskId: string;
      path: string;
      draft?: PersistedDialogDraft;
    }
  | {
      kind: "worktree";
      action: "remove" | "delete-branch";
      taskId: string;
      files?: string[];
      draft?: PersistedDialogDraft;
    };

/** Something in the selected task that the panel shares with the host's model. */
export type SharedItem = { kind: "file"; path: string };

export type Snapshot = {
  tasks: Task[];
  workers: Worker[];
  projects: Project[];
  events: Event[];
  /** Tally of the selected task's events that fell off the front of `events`. */
  droppedEvents?: DroppedSummary;
  selected?: string;
  conversation?: string;
  repository?: string;
  projectCandidate?: string;
  projectCandidateAuto?: boolean;
  revision: string;
  // Null until the user picks one; the list then follows the first nonempty filter.
  filter: Filter | null;
  search: string;
  tab: Tab;
  /** The selected task's changes, read when Changes or Details opens. */
  changes?: ChangesState;
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

/** Shareable view choices restored from the browser URL. */
export type PersistedViewState = Partial<
  Pick<Snapshot, "repository" | "selected" | "filter" | "search" | "tab">
> & {
  /** The user explicitly returned to the task list instead of selecting a task. */
  browsing?: boolean;
};

/** Browser-local UI state that should survive reloads but not appear in copied URLs. */
export type PersistedUiState = {
  view: PersistedViewState;
  /** Oldest to newest; the last dialog is the active one. */
  dialogs?: PersistedDialog[];
};

export type UiStatePersistence = {
  initial: PersistedUiState;
  save(state: PersistedUiState): void;
  flush?(): void;
};

export type { Event } from "../../../src/features/events/types.js";

export type {
  HostState,
  Transport,
  TransportEvents,
} from "../../adapters/transports/types.js";

export type { Project } from "../../features/projects/types.js";

export type { Worker } from "../../features/providers/types.js";

export type {
  Defaults,
  SettingsDocument,
  SettingValue,
} from "../../features/settings/types.js";

export type {
  Filter,
  Question,
  QuestionAnswers,
  QuestionDraft,
  Tab,
  Task,
} from "../../features/tasks/types.js";

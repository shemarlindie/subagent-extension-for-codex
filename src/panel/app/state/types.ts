/* eslint-disable simple-import-sort/exports */
import type { Event } from "../../../shared/events/types.js";
import type { PendingTaskUpdates } from "../../../shared/tasks/conversation/parent-updates.js";
import type { GitState } from "../../../shared/tasks/model.js";
import type {
  ChangeCountsState,
  ChangesState,
} from "../../features/changes/types.js";
import type { Project } from "../../features/projects/types.js";
import type { Worker } from "../../features/providers/types.js";
import type {
  Defaults,
  SettingsDocument,
} from "../../features/settings/types.js";
import type {
  ActivityFocus,
  DroppedSummary,
} from "../../features/tasks/activity/event-history.js";
import type { ChatState } from "../../features/tasks/chat/chat-state.js";
import type { DraftState } from "../../features/tasks/chat/drafts/draft-state.js";
import type { HandoffTarget } from "../../features/tasks/controls/handoff-message.js";
import type { Filter, Tab, Task } from "../../features/tasks/types.js";
import type { HostState } from "../../transports/types.js";
import type { PageId } from "../navigation/pages";
import type { ConnectionLabel } from "./connection.js";
import type { ComposerDraftPersistence } from "./session/session-state";
import type { UndoNotice } from "./undo-history";

export type PanelData = {
  // Host data arrives unchecked; applyScope validates these before use.
  panel_scope?: {
    conversation_id?: unknown;
    repository?: unknown;
    revision?: string;
  };
  panel_project_candidate?: {
    repository: string;
    git?: GitState;
    auto_register?: boolean;
  };
  panel_selection?: { task_id?: string; tab?: string };
  tasks?: Task[];
  read_completed?: unknown;
};

/** An `app_list_tasks` read. */
export type TaskList = {
  tasks: Task[];
  /** Completed tasks the user has read that `tasks` leaves out, by repository. */
  read_completed?: Record<string, number>;
};

export type DialogReadStatus = "loading" | "ready" | "error";

export type DelegateDialogRead =
  "context" | "settings" | "projects" | "workers";

/** The new-task composer's reads; present while the user composes a task. */
export type NewTaskState = {
  scope: number;
  request: number;
  statuses: Record<DelegateDialogRead, DialogReadStatus>;
  errors?: Partial<Record<DelegateDialogRead, string>>;
  defaults?: Defaults;
  /** A project added from the composer's project chip, for the chip to select. */
  addedProject?: string;
};

export type DialogState =
  | { kind: "remove-project"; project: Project; scope: number }
  | {
      kind: "project";
      repository?: string;
      /** Opened from the new-task composer, which selects the added project. */
      forNewTask?: boolean;
      scope: number;
    }
  // Settings use dialog persistence for their page form, not DialogHost.
  | { kind: "settings"; settings: SettingsDocument; scope: number }
  | {
      kind: "settings-loading";
      scope: number;
      request: number;
      status: DialogReadStatus;
      error?: string;
    }
  | {
      kind: "delegate";
      defaults: Defaults;
      preferredWorker?: string;
      repository?: string;
      revision: string;
      scope: number;
    }
  | {
      kind: "delegate-loading";
      scope: number;
      request: number;
      preferredWorker?: string;
      repository?: string;
      revision?: string;
      defaults?: Defaults;
      statuses: Record<DelegateDialogRead, DialogReadStatus>;
      errors?: Partial<Record<DelegateDialogRead, string>>;
      message?: string;
    }
  | { kind: "respond"; task: Task; scope: number }
  | { kind: "handoff"; task: Task; target?: HandoffTarget; scope: number }
  // Sends worker updates Codex hasn't seen, or marks them seen.
  | { kind: "pending-updates"; scope: number }
  // Confirms deleting the task and everything related to it.
  | { kind: "delete"; task: Task; scope: number }
  // A file the task changed, previewed as it is now and as its diff.
  | { kind: "file"; task: Task; path: string; scope: number }
  // Confirms removing a worktree with uncommitted `files`, or deleting a branch.
  | {
      kind: "worktree";
      action: "remove" | "delete-branch";
      task: Task;
      files?: string[];
      scope: number;
    };

/** Form edits are JSON-safe values keyed by each form's field names. */
export type PersistedDialogDraft = Record<string, unknown>;

/** Local dialog descriptors; server-owned task and settings data is reloaded. */
export type PersistedDialog =
  | { kind: "remove-project"; repository: string; draft?: PersistedDialogDraft }
  | {
      kind: "project";
      repository?: string;
      forNewTask?: boolean;
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
      kind: "respond";
      taskId: string;
      requestId?: string;
      draft?: PersistedDialogDraft;
    }
  | {
      kind: "handoff";
      taskId: string;
      target?: HandoffTarget;
      draft?: PersistedDialogDraft;
    }
  | { kind: "pending-updates"; draft?: PersistedDialogDraft }
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

/**
 * The "New" divider's position for the open task after the user marks it: the
 * read point just before the message they marked unread from, or no `through`
 * once they mark it read. Each mark gets a newer `revision`.
 */
export type NewMark = { task: string; through?: number; revision: number };

export type Snapshot = {
  page: PageId;
  tasks: Task[];
  /**
   * Completed tasks the user has read that `tasks` leaves out, by
   * repository, while the list shows neither Done nor All.
   */
  readCompleted?: Record<string, number>;
  workers: Worker[];
  projects: Project[];
  /** True once the project registry has been read successfully. */
  projectsLoaded: boolean;
  /** True once available worker profiles have been read successfully. */
  workersLoaded: boolean;
  events: Event[];
  /** Tally of the selected task's events that fell off the front of `events`. */
  droppedEvents?: DroppedSummary;
  /** A turn whose activity Chat's View activity asked to show. */
  activityFocus?: ActivityFocus;
  /** The selected task's Chat, read alongside its events. */
  chat?: ChatState;
  /** The selected task's initial Chat history read is pending. */
  chatHistoryLoading?: string;
  /** The selected task's initial Activity history read is pending. */
  activityHistoryLoading?: string;
  /** The current scope's first task-list read is still pending. */
  taskListLoading: boolean;
  /** The selected task's message being written, streamed or read. */
  draft?: DraftState;
  /** Where Chat's "New" divider moved when the user marked the task unread from a message. */
  newMark?: NewMark;
  taskArrival?: Pick<Task, "id" | "title">;
  /** Worker updates Codex hasn't seen, from the last read in a conversation. */
  pendingUpdates?: { conversation: string; tasks: PendingTaskUpdates[] };
  /** The undo toast's message, until it times out or is closed. */
  undoNotice?: UndoNotice;
  /** Counts applied undo and redo steps, so views with their own reads reload. */
  undoRevision: number;
  selected?: string;
  /** Set while the inspector shows the new-task composer instead of a task. */
  newTask?: NewTaskState;
  conversation?: string;
  repository?: string;
  projectCandidate?: string;
  projectCandidateAuto?: boolean;
  projectCandidateGit?: GitState;
  revision: string;
  // Null until the user picks one; the list then follows the first nonempty filter.
  filter: Filter | null;
  search: string;
  tab: Tab;
  /** The selected task's change totals, for its tab count and Details. */
  changeCounts?: ChangeCountsState;
  /** The selected task's changes, read while the Changes tab is open. */
  changes?: ChangesState;
  connected: boolean;
  scopeKnown: boolean;
  busy: boolean;
  connection: ConnectionLabel;
  error: string;
  loginRequired: boolean;
  dialog?: DialogState;
  formError: string;
  scopeVersion: number;
  host: HostState;
};

/** Shareable view choices restored from the browser URL. */
export type PersistedViewState = Partial<
  Pick<
    Snapshot,
    "repository" | "selected" | "filter" | "search" | "tab" | "page"
  >
> & {
  /** The user explicitly returned to the task list instead of selecting a task. */
  browsing?: boolean;
  composing?: boolean;
};

/** Browser-local UI state that should survive reloads but not appear in copied URLs. */
type PersistedUiState = {
  view: PersistedViewState;
  /** The last selected settings section, kept separately from unsaved drafts. */
  lastSettingsSection?: string;
  /** Oldest to newest; the last dialog is the active one. */
  dialogs?: PersistedDialog[];
};

export type UiStatePersistence = {
  initial: PersistedUiState;
  composerDrafts?: ComposerDraftPersistence;
  save(state: PersistedUiState): void;
  flush?(): void;
};

export type { Event } from "../../../shared/events/types.js";

export type {
  HostState,
  Transport,
  TransportEvents,
} from "../../transports/types.js";

export type { Project } from "../../features/projects/types.js";

export type { Worker } from "../../features/providers/types.js";

export type {
  Defaults,
  SettingsDocument,
} from "../../features/settings/types.js";

export type {
  Filter,
  Question,
  QuestionAnswers,
  QuestionDraft,
  Tab,
  Task,
} from "../../features/tasks/types.js";

/* eslint-disable simple-import-sort/exports */

import type { Event } from "../../../src/features/events/types.js";
import type { HostState } from "../../adapters/transports/types.js";
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
  | { kind: "control"; action: string; task: Task; scope: number }
  | { kind: "respond"; task: Task; scope: number }
  | { kind: "handoff"; task: Task; scope: number };

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

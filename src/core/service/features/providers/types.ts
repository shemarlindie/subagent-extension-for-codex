import type { StructuredPatchHunk as Hunk } from "diff";

import type { ProviderAbout } from "../../../shared/about/types.js";
import type {
  EventEmitter,
  OpaqueEventEmitter,
} from "../../../shared/events/event-types.js";
import type { ProviderMetadata } from "../../../shared/providers/metadata.js";
import type { SessionOptionKey } from "../../../shared/providers/options.js";
import type { PlanUsage } from "../../../shared/providers/plan-usage.js";
import type {
  Capabilities,
  ModelChoice,
  ProviderCommand,
  ProviderPolicy,
  ProviderReadiness,
  SessionDeletionStatus,
} from "../../../shared/providers/types.js";
import type { SettingsValues } from "../../../shared/settings/settings-schema.js";
import type { InputPresentation, Task } from "../../../shared/tasks/model.js";
import type { PlanStep } from "../../../shared/tasks/plan-contract.js";
import type { WrapUp } from "../../../shared/tasks/wrap-up-contract.js";
import type { ProviderTaskPolicy } from "./task-policy.js";

/** A message sent into a running turn. */
export interface Steer {
  id: string;
  text: string;
}

export interface FileEdit {
  path: string;
  hunks: Hunk[];
  created?: true;
  deleted?: true;
  source: "tool" | "command";
}

export interface RunContext {
  /** Records a tool edit durably in the task and latest turn. */
  fileChanged(edit: FileEdit): void;
  /** Reports an edit whose diff could not be captured. */
  editUnrecorded(path?: string, source?: FileEdit["source"]): void;
  task: Task;
  /**
   * The real path of the task's attachment folder, which the worker reads
   * and must not change. Task control always sets it, since a steer can bring
   * the first attachment mid-turn.
   */
  attachments?: string;
  /** Aborted to interrupt the turn, which then ends as interrupted. */
  signal: AbortSignal;
  /**
   * Registers where steers go while the turn runs. Control sends each one
   * there, including any sent before the provider registered; the sink
   * returns false when the turn can't take it any more, as it ends.
   */
  acceptSteers(sink: (steer: Steer) => boolean): void;
  /** Reports that the turn ended without sending its prompt, so the next one sends it. */
  promptHeld(): void;
  /** Reports that the turn took a steer. One it never takes is left over. */
  steerTaken(id: string): void;
  /**
   * Saves the worker's plan on the task and records it. `changed` lists the
   * steps whose status changed when the contents match the previous plan's.
   * An empty list clears the plan.
   */
  planUpdated(steps: PlanStep[], changed?: number[]): void;
  /**
   * Shows a visual in Chat and returns its number. With `replaces`, the new
   * version takes that visual's place and number. Throws for code over
   * `MAX_VISUAL_CODE` or a number the task hasn't shown.
   */
  visualShown(title: string, code: string, replaces?: number): number;
  /**
   * Holds the worker's wrap-up for the turn's reply and checks off the plan.
   * A later call replaces it, and a steer taken after it drops it. Throws for
   * a wrap-up that breaks the field rules.
   */
  wrappedUp(wrapUp: WrapUp): void;
  /**
   * Streams text as the worker writes a message, before the message itself
   * is emitted. Deltas aren't stored.
   */
  delta(messageId: string, text: string): void;
  /** Emits a known project event while retaining provider-specific typed fields. */
  emit: EventEmitter;
  /** Explicit escape path for provider-owned or future event names. */
  emitOpaque: OpaqueEventEmitter;
  session: (id: string, stateRef?: string) => void;
  /**
   * Stores a value the session reports under `provider_options.<id>.<key>`,
   * replacing the earlier one.
   */
  sessionOption(key: SessionOptionKey, value: Record<string, unknown>): void;
  input: (
    tool: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    presentation?: InputPresentation,
  ) => Promise<{
    approved: boolean;
    input?: Record<string, unknown>;
    message?: string;
  }>;
}

/** What a successful turn returns: the worker's reply, in plain text or Markdown. */
export interface TurnOutput {
  reply: string;
  /** The reply is what a command such as /compact printed. */
  commandOutput?: true;
}

export interface PlanUsageReader {
  /**
   * The last value read: undefined before the first read, null when no plan
   * limits apply. A missing or old value starts a read.
   */
  current(settings?: SettingsValues): PlanUsage | null | undefined;
  /** Reads for a user, more often than `current` would. Resolves once read. */
  refreshNow(settings?: SettingsValues): Promise<void>;
  /** Calls `listener` after each successful read. */
  watch(listener: () => void): void;
}

export interface Provider {
  id: string;
  capabilities: Capabilities;
  metadata?: ProviderMetadata;
  about?(refresh: boolean): Promise<ProviderAbout>;
  taskPolicy: ProviderTaskPolicy;
  /** Checks the local runtime the provider launches; auth and network failures surface later. */
  readiness?(options?: { refresh?: boolean }): Promise<ProviderReadiness>;
  /**
   * The models a session offers. `repository` is an approved project folder
   * whose own settings apply. Without one, settings outside any project do.
   */
  models?(
    settings?: SettingsValues,
    repository?: string,
  ): Promise<ModelChoice[]>;
  /** What org policy limits for new tasks. Nothing means nothing known. */
  policy?(
    settings?: SettingsValues,
    repository?: string,
  ): Promise<ProviderPolicy | undefined>;
  /** The slash commands the task's session offers, for suggestions. */
  commands?(task: Task): Promise<ProviderCommand[]>;
  /** The signed-in account's plan usage. */
  planUsage?: PlanUsageReader;
  run(context: RunContext, prompt: string): Promise<TurnOutput>;
  /** Deletes the provider-side session a task ran in; one already gone is not an error. */
  deleteSession?(task: Task, expectedVersion?: string): Promise<void>;
  /** Checks whether this task's provider session has a known cleanup location. */
  sessionDeletionStatus?(task: Task): Promise<SessionDeletionStatus>;
  /** Archives or unarchives the provider-side session a task ran in. */
  setSessionArchived?(task: Task, archived: boolean): Promise<void>;
  close?(): Promise<void>;
}

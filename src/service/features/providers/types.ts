import type {
  EventEmitter,
  OpaqueEventEmitter,
} from "../../../shared/events/event-types.js";
import type { ProviderMetadata } from "../../../shared/providers/metadata.js";
import type {
  Capabilities,
  ModelChoice,
  ProviderReadiness,
} from "../../../shared/providers/types.js";
import type { InputPresentation, Task } from "../../../shared/tasks/model.js";
import type { ProviderTaskPolicy } from "./task-policy.js";

/** A message sent into a running turn. */
export interface Steer {
  id: string;
  text: string;
}

export interface RunContext {
  task: Task;
  /** Aborted to interrupt the turn, which then ends as interrupted. */
  signal: AbortSignal;
  /**
   * Registers where steers go while the turn runs. Control sends each one
   * there, including any sent before the provider registered; the sink
   * returns false when the turn can't take it any more, as it ends.
   */
  acceptSteers(sink: (steer: Steer) => boolean): void;
  /** Reports that the turn took a steer. One it never takes is left over. */
  steerTaken(id: string): void;
  /**
   * Streams text as the worker writes a message, before the message itself
   * is emitted. Deltas aren't stored.
   */
  delta(messageId: string, text: string): void;
  /** Queue a worker message for the open parent panel; returns its durable event ID. */
  messageParent?(text: string): number;
  /** Emits a known project event while retaining provider-specific typed fields. */
  emit: EventEmitter;
  /** Explicit escape path for provider-owned or future event names. */
  emitOpaque: OpaqueEventEmitter;
  session: (id: string, stateRef: string) => void;
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
}

export interface Provider {
  id: string;
  capabilities: Capabilities;
  metadata?: ProviderMetadata;
  taskPolicy: ProviderTaskPolicy;
  /** Checks the local runtime the provider launches; auth and network failures surface later. */
  readiness?(): Promise<ProviderReadiness>;
  models?(): Promise<ModelChoice[]>;
  run(context: RunContext, prompt: string): Promise<TurnOutput>;
  /** Deletes the provider-side session a task ran in; one already gone is not an error. */
  deleteSession?(task: Task): Promise<void>;
  close?(): Promise<void>;
}

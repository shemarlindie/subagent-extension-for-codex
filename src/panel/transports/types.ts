import type { DraftUpdate } from "../../shared/tasks/conversation/drafts.js";
import type { ConnectionLabel } from "../app/state/connection.js";
import type { PanelData } from "../app/state/types.js";

export type HostState = {
  locale?: string;
  timeZone?: string;
  canSend: boolean;
  /** Host supports automatic submission through the OpenAI message extension. */
  canSendParent?: boolean;
  canShare: boolean;
  canExpand: boolean;
  displayMode: "inline" | "fullscreen" | "pip";
};

export type TransportEvents = {
  scope(data: PanelData): void;
  status(text: ConnectionLabel): void;
  login(): void;
  host(state: HostState): void;
  teardown(): void;
  /** A streamed change to a running task's draft. */
  draft(update: DraftUpdate): void;
  /** The service's current revision, an opaque token that changes with its data. */
  revision(value: string): void;
};

export interface Transport {
  embedded: boolean;
  /** Revisions arrive as the service changes; otherwise the panel waits for them. */
  streamsChanges?: boolean;
  /** Drafts arrive as they're written; otherwise the panel reads them. */
  streamsDrafts?: boolean;
  connect(events: TransportEvents): Promise<void>;
  tool<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  watch(): void;
  dispose(): void;
  /** `submit` requests host submission; the host may queue it during an active turn. */
  send?(message: string, options?: { submit?: boolean }): Promise<void>;
  share?(data: Record<string, unknown>): Promise<void>;
  expand?(): Promise<void>;
  /** Opens an external link through the host, which may block new windows. */
  openLink?(url: string): Promise<void>;
  login?(token: string): Promise<void>;
}

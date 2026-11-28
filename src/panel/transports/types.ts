import type { DraftUpdate } from "../../core/shared/tasks/conversation/drafts.js";
import type { ObservePanelTiming } from "../../core/shared/tasks/panel-timing.js";
import type { ConnectionLabel } from "../app/state/connection.js";
import type { PanelData } from "../app/state/types.js";

export type HostState = {
  locale?: string;
  timeZone?: string;
  canSend: boolean;
  canShare: boolean;
  canExpand: boolean;
  /** The host opens files by path in its own viewer. */
  canOpenFiles: boolean;
  displayMode: "inline" | "fullscreen" | "pip";
};

/**
 * How a save went. A host without file downloads is `unsupported`. A host
 * error is `declined`, and includes a cancelled dialog.
 */
export type SaveResult = "saved" | "unsupported" | "declined";

export type TransportEvents = {
  timing?: ObservePanelTiming;
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
  /** `signal` ends the call here. The service may still run it. */
  tool<T>(
    name: string,
    args?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T>;
  watch(): void;
  dispose(): void;
  /** Sends a user message to the host chat, which may queue it during an active turn. */
  send?(message: string): Promise<void>;
  share?(data: Record<string, unknown>): Promise<void>;
  expand?(): Promise<void>;
  /** Opens an external link through the host, which may block new windows. */
  openLink?(url: string): Promise<void>;
  /** Opens an absolute path in the host's viewer, when the host can. */
  openFile?(path: string): Promise<void>;
  /** Saves a file through the host or browser. */
  saveFile(file: File): Promise<SaveResult>;
  login?(token: string): Promise<void>;
}

import type { DraftUpdate } from "../../../src/features/tasks/drafts.js";
import type { PanelData } from "../../shared/state/types.js";

export type HostState = {
  locale?: string;
  timeZone?: string;
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
  /** A streamed change to a running task's draft. */
  draft(update: DraftUpdate): void;
};

export interface Transport {
  embedded: boolean;
  /** Drafts arrive as they're written; otherwise the panel reads them. */
  streamsDrafts?: boolean;
  connect(events: TransportEvents): Promise<void>;
  tool<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  watch(): void;
  dispose(): void;
  send?(message: string): Promise<void>;
  share?(data: Record<string, unknown>): Promise<void>;
  expand?(): Promise<void>;
  login?(token: string): Promise<void>;
}

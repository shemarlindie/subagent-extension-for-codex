import type { PanelData } from "../../shared/state/types.js";

export type HostState = {
  canSend: boolean;
  canShare: boolean;
  canDownload: boolean;
  canExpand: boolean;
  displayMode: "inline" | "fullscreen" | "pip";
};

/** A file to save; `base64` carries binary content, `text` everything else. */
export type DownloadFile = {
  name: string;
  mimeType: string;
} & ({ text: string; base64?: never } | { base64: string; text?: never });

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
  connect(events: TransportEvents): Promise<void>;
  tool<T>(name: string, args?: Record<string, unknown>): Promise<T>;
  watch(): void;
  dispose(): void;
  send?(message: string): Promise<void>;
  share?(data: Record<string, unknown>): Promise<void>;
  /** Saves a file for the user; hosts confirm first and may decline. */
  download?(file: DownloadFile): Promise<void>;
  expand?(): Promise<void>;
  login?(token: string): Promise<void>;
}

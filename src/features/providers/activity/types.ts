/** Built-in providers may attach this presentation contract without changing raw events. */
export interface ActivityPresentation {
  kind?: string;
  title?: string;
  summary?: string;
  statusTitle?: string;
  /** False for housekeeping that should not replace the current work status. */
  liveStatus?: boolean;
  quiet?: boolean;
  thinking?: boolean;
  failed?: boolean;
  messageId?: string;
  hasThinking?: boolean;
  statusState?: "running" | "completed" | "failed" | "info";
  operation?: {
    id: string;
    kind: "tool" | "operation";
    title: string;
    summary?: string;
    started?: boolean;
    completed?: boolean;
    stopped?: boolean;
  };
  stream?: {
    id: string;
    messageId?: string;
    started?: boolean;
    completed?: boolean;
    title?: string;
    content?: unknown;
    details?: Record<string, unknown>;
    update?: {
      index: number;
      block?: Record<string, unknown>;
      append?: { field: string; type: string; text: string };
    };
  };
  body?: { content?: unknown; error?: unknown };
}

/** Provider-neutral content understood by the activity and conversation views. */
export type ActivityContent = string | ActivityContentBlock;

export type ActivityContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "input_json_delta"; partial_json: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string | ActivityContent[];
      is_error?: boolean;
    }
  | { type: "opaque"; data: Record<string, unknown> };

/** A provider's reported utilization window, independent of its SDK payload. */
export interface ActivityRateLimitWindow {
  id: string;
  label: string;
  /** Used fraction, where 1 means 100%. */
  utilization: number;
  /** Reset time in Unix seconds. */
  resetsAt?: number;
}

export type ActivityStreamAppend =
  | { field: "text"; type: "text"; text: string }
  | { field: "thinking"; type: "thinking"; text: string }
  | { field: "partial_json"; type: "input_json_delta"; text: string };

/** Normalized metadata that lets shared activity UI stay provider-neutral. */
export interface ActivityPresentation {
  kind?: string;
  title?: string;
  summary?: string;
  /** True when the summary is the worker's response text and should render as Markdown. */
  summaryIsResponse?: boolean;
  statusTitle?: string;
  /** False for housekeeping that should not replace the current work status. */
  liveStatus?: boolean;
  quiet?: boolean;
  thinking?: boolean;
  failed?: boolean;
  messageId?: string;
  hasThinking?: boolean;
  rateLimitWindows?: ActivityRateLimitWindow[];
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
    content?: ActivityContent | ActivityContent[];
    /** Provider diagnostics can contain fields with no shared meaning. */
    details?: Record<string, unknown>;
    update?: {
      index: number;
      block?: ActivityContentBlock;
      append?: ActivityStreamAppend;
    };
  };
  body?: {
    role?: "assistant" | "user";
    content?: ActivityContent[];
    error?: boolean | string;
  };
}

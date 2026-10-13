import { activityPresentation } from "../../../../shared/providers/activity/presentation";
import type { ActivityRateLimitWindow } from "../../../../shared/providers/activity/types";
import type { Event } from "../../../app/state/types";
import {
  formatUserDateTime,
  type UserDateTimePreferences,
} from "../../../shared/utils/user-date-time";
import { formatDuration } from "../list/duration";

// Keep prose blocks and structured metadata within the same nesting budget.
export const MAX_ACTIVITY_DEPTH = 6;

export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const label = (key: string) => {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_.]/g, " ");

  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** User-authored text stays literal, like its Chat bubble. */
export function userMessageText(event: Event): string | undefined {
  if (event.type === "task.instruction")
    return event.data.from === "user" && typeof event.data.message === "string"
      ? event.data.message
      : undefined;
  if (
    !["agent.message", "agent.content"].includes(event.type) ||
    event.data.role !== "user"
  )
    return undefined;
  if (typeof event.data.text === "string") return event.data.text;
  if (typeof event.data.content === "string") return event.data.content;

  const blocks = Array.isArray(event.data.content)
    ? event.data.content
    : [event.data.content];

  if (!blocks.length || !blocks.every((block) => record(block).type === "text"))
    return undefined;

  return blocks.map((block) => String(record(block).text ?? "")).join("\n");
}

/** Message text is inspected in raw JSON; attachments and thinking stay visible. */
export function visibleMessageContent(event: Event, hideResponseText: boolean) {
  if (userMessageText(event) !== undefined) return [];
  const content = event.data.content ?? event.data.text;
  const blocks = Array.isArray(content) ? content : [content];
  if (
    event.data.role === "user" ||
    (!hideResponseText && event.type !== "agent.message")
  )
    return blocks.filter((block) => block !== undefined);

  return blocks.filter((block) => {
    const type = record(block).type;

    return (
      typeof block !== "string" && type !== "text" && type !== "text_delta"
    );
  });
}

export function formatActivityTime(
  timestamp: string,
  preferences: UserDateTimePreferences = {},
) {
  const options: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
  };

  try {
    return new Date(timestamp).toLocaleTimeString(preferences.locale, {
      ...options,
      timeZone: preferences.timeZone,
    });
  } catch {
    return new Date(timestamp).toLocaleTimeString(undefined, options);
  }
}

export function eventTitle(event: Event, failed: boolean, toolName?: string) {
  const { data } = event;
  const presentation = activityPresentation(event);
  if (presentation.title) return presentation.title;
  if (event.type === "agent.message") return "Worker message";
  if (event.type === "agent.content")
    return data.role === "user" ? "User content" : "Agent content";
  if (event.type === "tool.started") return `${data.name ?? "Tool"} started`;
  if (event.type === "tool.completed")
    return `${toolName ?? "Tool"} ${failed ? "failed" : "completed"}`;
  if (event.type === "agent.started") return "Agent started";
  if (event.type === "agent.completed")
    return `Agent ${failed ? "failed" : "finished"}`;

  return label(event.type);
}

/** Rebuilds visible content blocks from provider-normalized stream updates. */
export function streamContent(events: Event[]) {
  const blocks = new Map<number, Record<string, unknown>>();

  for (const event of events) {
    const update = activityPresentation(event).stream?.update;
    if (!update) continue;
    const { index, block: initial, append } = update;
    if (!Number.isSafeInteger(index) || index < 0) continue;
    if (initial) blocks.set(index, { ...initial });

    if (append) {
      const block = blocks.get(index) ?? {};
      block.type = append.type;
      block[append.field] = String(block[append.field] ?? "") + append.text;
      blocks.set(index, block);
    }
  }

  return [...blocks.values()];
}

function isThinkingBlock(block: unknown) {
  const type = record(block).type;

  return type === "thinking" || type === "redacted_thinking";
}

/** True when every message in the group holds only thinking blocks. */
export function thinkingOnly(events: Event[]) {
  return (
    events.length > 0 &&
    events.every((event) => {
      // The provider emits one content block per event; accept arrays too.
      const content = event.data.content ?? event.data.text;
      const blocks = Array.isArray(content) ? content : [content];

      return blocks.length > 0 && blocks.every(isThinkingBlock);
    })
  );
}

/**
 * Whether a row's summary is the worker's Markdown response: a reply, or the
 * SDK result that repeats it. Other summaries are plain status text.
 */
export function summaryIsResponse(events: Event[], summary: string) {
  return events.some(
    (event) => event.data.type === "result" && event.data.result === summary,
  );
}

const RESPONSE_PREVIEW_LENGTH = 100;

/** The opening characters of a reply; More expands the full text in its row. */
export function responsePreview(text: string) {
  const chars = Array.from(text);

  return chars.length > RESPONSE_PREVIEW_LENGTH
    ? `${chars.slice(0, RESPONSE_PREVIEW_LENGTH).join("").trimEnd()}...`
    : text;
}

const tokenCount = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const compactNumber = (value: number) =>
  new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

/** Headline numbers of a completed turn, readable without opening its debug view. */
export function turnStats(event: Event) {
  const data = event.data;
  const usage = record(data.usage);
  const stats: string[] = [];

  if (typeof data.duration_ms === "number" && Number.isFinite(data.duration_ms))
    stats.push(formatDuration(data.duration_ms));

  const input =
    tokenCount(usage.input_tokens) +
    tokenCount(usage.cache_creation_input_tokens) +
    tokenCount(usage.cache_read_input_tokens);

  const output = tokenCount(usage.output_tokens);

  if (input || output)
    stats.push(
      `${compactNumber(input)} in · ${compactNumber(output)} out tokens`,
    );

  // Providers report the session's cumulative cost, not this turn's.
  if (typeof data.cost_usd === "number" && Number.isFinite(data.cost_usd))
    stats.push(
      `${new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 4,
      }).format(data.cost_usd)} session cost`,
    );

  return stats;
}

/** Latest normalized utilization for each rate-limit window in a status group. */
export function rateLimitStats(
  events: Event[],
  preferences?: UserDateTimePreferences,
) {
  const windows = new Map<string, ActivityRateLimitWindow>();

  for (const event of events)
    for (const window of activityPresentation(event).rateLimitWindows ?? [])
      windows.set(window.id, window);

  return [...windows.values()].map((window) => {
    const stats = [
      window.label,
      `${(window.utilization * 100).toLocaleString()}% used`,
    ];

    if (window.resetsAt !== undefined)
      stats.push(
        `Resets ${formatUserDateTime(new Date(window.resetsAt * 1000).toISOString(), preferences, { timeZoneName: undefined, second: undefined })}`,
      );

    return stats.join(" · ");
  });
}

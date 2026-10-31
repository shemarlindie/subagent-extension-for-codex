import { eventPayload } from "../../../../shared/events/payload";
import { activityPresentation } from "../../../../shared/providers/activity/presentation";
import type {
  ActivityContent,
  ActivityContentBlock,
} from "../../../../shared/providers/activity/types";
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

function isTextContent(
  block: ActivityContent,
): block is Extract<ActivityContentBlock, { type: "text" }> {
  return typeof block !== "string" && block.type === "text";
}

/** User-authored text stays literal, like its Chat bubble. */
export function userMessageText(event: Event): string | undefined {
  const instruction = eventPayload(event, "task.instruction");

  if (instruction) {
    return instruction.from === "user" ? instruction.message : undefined;
  }

  const message =
    eventPayload(event, "agent.message") ??
    eventPayload(event, "agent.content");

  if (!message || message.role !== "user") return undefined;

  if (message.text !== undefined) return message.text;
  const content = message.content;
  if (typeof content === "string") return content;

  if (!Array.isArray(content) && isTextContent(content)) {
    return content.text;
  }

  if (
    Array.isArray(content) &&
    content.every((block) => typeof block === "string" || isTextContent(block))
  ) {
    return content
      .map((block) => (typeof block === "string" ? block : block.text))
      .join("\n");
  }

  return undefined;
}

/** Message text is inspected from typed content; attachments and thinking stay visible. */
export function visibleMessageContent(event: Event, hideResponseText: boolean) {
  if (userMessageText(event) !== undefined) return [];

  const message =
    eventPayload(event, "agent.message") ??
    eventPayload(event, "agent.content");

  const content: ActivityContent | ActivityContent[] | undefined =
    message?.content ?? message?.text;

  let blocks: ActivityContent[];
  if (content === undefined) blocks = [];
  else if (Array.isArray(content)) blocks = content;
  else blocks = [content];

  if (
    message?.role === "user" ||
    (!hideResponseText && event.type !== "agent.message")
  ) {
    return blocks;
  }

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
  const presentation = activityPresentation(event);
  if (presentation.title) return presentation.title;
  if (eventPayload(event, "agent.message")) return "Worker message";

  const content = eventPayload(event, "agent.content");

  if (content) {
    return content.role === "user" ? "User content" : "Agent content";
  }

  const started = eventPayload(event, "tool.started");

  if (started) {
    return `${started.name ?? "Tool"} started`;
  }

  if (eventPayload(event, "tool.completed")) {
    return `${toolName ?? "Tool"} ${failed ? "failed" : "completed"}`;
  }

  if (eventPayload(event, "agent.started")) return "Agent started";

  if (eventPayload(event, "agent.completed")) {
    return `Agent ${failed ? "failed" : "finished"}`;
  }

  return label(event.type);
}

/** Rebuilds visible content blocks from provider-normalized stream updates. */
export function streamContent(events: Event[]) {
  const blocks = new Map<number, ActivityContentBlock>();

  for (const event of events) {
    const update = activityPresentation(event).stream?.update;
    if (!update) continue;
    const { index, block: initial, append } = update;
    if (!Number.isSafeInteger(index) || index < 0) continue;
    if (initial) blocks.set(index, { ...initial });

    if (append) {
      switch (append.field) {
        case "text": {
          const previous = blocks.get(index);
          const text = previous?.type === "text" ? previous.text : "";
          blocks.set(index, { type: "text", text: text + append.text });
          break;
        }

        case "thinking": {
          const previous = blocks.get(index);

          const thinking =
            previous?.type === "thinking" ? previous.thinking : "";

          blocks.set(index, {
            type: "thinking",
            thinking: thinking + append.text,
          });

          break;
        }

        case "partial_json": {
          const previous = blocks.get(index);

          const partialJson =
            previous?.type === "input_json_delta" ? previous.partial_json : "";

          blocks.set(index, {
            type: "input_json_delta",
            partial_json: partialJson + append.text,
          });

          break;
        }
      }
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
      const message =
        eventPayload(event, "agent.message") ??
        eventPayload(event, "agent.content");

      const content = message?.content ?? message?.text;

      let blocks: unknown[];

      if (content === undefined) blocks = [];
      else if (Array.isArray(content)) blocks = content;
      else blocks = [content];

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
    (event) =>
      eventPayload(event, "agent.completed")?.result === summary ||
      (event.presentation?.summaryIsResponse === true &&
        event.presentation.summary === summary),
  );
}

/** The parent agent writes Markdown briefs, rendered as in its Chat bubble. */
export function summaryIsParentMessage(events: Event[], summary: string) {
  return events.some((event) => {
    const instruction = eventPayload(event, "task.instruction");

    return instruction?.from === "parent" && instruction.message === summary;
  });
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
  const data = eventPayload(event, "agent.completed");
  const usage = data?.usage;
  const stats: string[] = [];

  if (
    typeof data?.duration_ms === "number" &&
    Number.isFinite(data.duration_ms)
  ) {
    stats.push(formatDuration(data.duration_ms));
  }

  const input =
    tokenCount(usage?.input_tokens) +
    tokenCount(usage?.cache_creation_input_tokens) +
    tokenCount(usage?.cache_read_input_tokens);

  const output = tokenCount(usage?.output_tokens);

  if (input || output) {
    stats.push(
      `${compactNumber(input)} in · ${compactNumber(output)} out tokens`,
    );
  }

  // Providers report the session's cumulative cost, not this turn's.
  if (typeof data?.cost_usd === "number" && Number.isFinite(data.cost_usd)) {
    stats.push(
      `${new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 4,
      }).format(data.cost_usd)} session cost`,
    );
  }

  return stats;
}

/** Latest normalized utilization for each rate-limit window in a status group. */
export function rateLimitStats(
  events: Event[],
  preferences?: UserDateTimePreferences,
) {
  const windows = new Map<string, ActivityRateLimitWindow>();

  for (const event of events) {
    for (const window of activityPresentation(event).rateLimitWindows ?? []) {
      windows.set(window.id, window);
    }
  }

  return [...windows.values()].map((window) => {
    const stats = [
      window.label,
      `${(window.utilization * 100).toLocaleString()}% used`,
    ];

    if (window.resetsAt !== undefined) {
      stats.push(
        `Resets ${formatUserDateTime(new Date(window.resetsAt * 1000).toISOString(), preferences, { timeZoneName: undefined, second: undefined })}`,
      );
    }

    return stats.join(" · ");
  });
}

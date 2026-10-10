import { activityPresentation } from "../../../../shared/providers/activity/presentation";
import type { Event } from "../../../app/state/types";
import type { UserDateTimePreferences } from "../../../shared/utils/user-date-time";

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

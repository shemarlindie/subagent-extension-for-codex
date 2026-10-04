import { activityFailed, activityKind } from "./activity-timeline";
import { formatDuration } from "./duration";
import type { Event } from "./types";

export const EVENT_TAIL_SIZE = 200;

/** What fell off the front of a task's activity once it outgrew the tail. */
export type DroppedSummary = {
  task_id: string;
  count: number;
  /** Timestamps of the first and last dropped event. */
  from: string;
  to: string;
  toolCalls: number;
  /** Tool calls by tool name. */
  tools: Record<string, number>;
  messages: number;
  failures: number;
  retries: number;
  artifacts: number;
};

export type EventTail = { events: Event[]; dropped?: DroppedSummary };

/** Tally dropped events onto a running summary without mutating the previous one. */
export function addDropped(
  previous: DroppedSummary | undefined,
  dropped: Event[],
): DroppedSummary | undefined {
  if (!dropped.length) return previous;

  const summary: DroppedSummary = previous
    ? { ...previous, tools: { ...previous.tools } }
    : {
        task_id: dropped[0].task_id,
        count: 0,
        from: dropped[0].timestamp,
        to: dropped[0].timestamp,
        toolCalls: 0,
        tools: {},
        messages: 0,
        failures: 0,
        retries: 0,
        artifacts: 0,
      };

  for (const event of dropped) {
    summary.count++;
    summary.to = event.timestamp;

    if (event.type === "tool.started") {
      summary.toolCalls++;

      const name =
        typeof event.data.name === "string" ? event.data.name : "Tool";

      summary.tools[name] = (summary.tools[name] ?? 0) + 1;
    }

    if (event.type === "agent.message" && event.data.role !== "user")
      summary.messages++;
    if (activityFailed(event)) summary.failures++;
    if (activityKind(event) === "api_retry") summary.retries++;
    if (event.type === "artifact.created") summary.artifacts++;
  }

  return summary;
}

/** Drain service pages without retaining unbounded history or advancing a stale view. */
export async function readEventTail(
  taskId: string,
  previous: Event[],
  read: (after: number) => Promise<Event[]>,
  isCurrent: () => boolean,
  previousDropped?: DroppedSummary,
): Promise<EventTail> {
  let recent = previous.filter((event) => event.task_id === taskId),
    after = recent.at(-1)?.id ?? 0,
    // A summary only continues the history it was tallied from.
    dropped =
      recent.length && previousDropped?.task_id === taskId
        ? previousDropped
        : undefined;

  for (;;) {
    const page = await read(after);
    if (!isCurrent()) return { events: [] };
    // Keep the same array when nothing arrived so unchanged views skip rendering.
    if (!page.length)
      return {
        events: recent.length === previous.length ? previous : recent,
        dropped,
      };
    recent = [...recent, ...page];

    if (recent.length > EVENT_TAIL_SIZE) {
      const overflow = recent.length - EVENT_TAIL_SIZE;
      dropped = addDropped(dropped, recent.slice(0, overflow));
      recent = recent.slice(overflow);
    }

    const cursor = page.at(-1)!.id;
    if (page.length < 1000 || cursor <= after)
      return { events: recent, dropped };
    after = cursor;
  }
}

const plural = (count: number, noun: string) =>
  `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

/** Readable lines for the note shown where the timeline's older rows were dropped. */
export function describeDropped(summary: DroppedSummary) {
  const elapsed = Date.parse(summary.to) - Date.parse(summary.from),
    tools = Object.entries(summary.tools).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    ),
    shown = tools.slice(0, 3).map(([name, n]) => `${name} ${n}`),
    hidden = tools.length - shown.length;

  return {
    headline: `${plural(summary.count, "earlier event")}${
      elapsed >= 1000 ? ` over ${formatDuration(elapsed)}` : ""
    } not shown.`,
    details: [
      summary.toolCalls &&
        `${plural(summary.toolCalls, "tool call")} (${shown.join(", ")}${
          hidden > 0 ? `, +${hidden} more` : ""
        })`,
      summary.messages && plural(summary.messages, "message"),
      summary.failures && plural(summary.failures, "failure"),
      summary.retries &&
        `${summary.retries.toLocaleString()} ${summary.retries === 1 ? "retry" : "retries"}`,
      summary.artifacts && plural(summary.artifacts, "artifact"),
    ].filter((part): part is string => Boolean(part)),
  };
}

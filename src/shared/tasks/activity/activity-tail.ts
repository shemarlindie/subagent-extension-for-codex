import type { Event } from "../../events/types.js";
import { activityFailed, activityKind } from "./activity-timeline.js";

/** How many of a task's newest events its activity shows; older ones are tallied. */
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
};

/**
 * get_user_agent_activity's result: the newest events after a cursor, the
 * task's event total, and a tally of the older events outside the window.
 */
export type ActivityPage = {
  events: Event[];
  /** Every event the task has, not only the ones returned. */
  total: number;
  /** Absent when no event has fallen outside the window. */
  dropped?: DroppedSummary;
};

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
  }

  return summary;
}

/**
 * The page for an in-memory log: the window of its newest events after the
 * cursor, and a tally of the rest. Matches the service's reads, for fixtures.
 */
export function windowActivity(events: Event[], after = 0): ActivityPage {
  const start = Math.max(0, events.length - EVENT_TAIL_SIZE),
    dropped = addDropped(undefined, events.slice(0, start));

  return {
    events: events.slice(start).filter((event) => event.id > after),
    total: events.length,
    ...(dropped ? { dropped } : {}),
  };
}

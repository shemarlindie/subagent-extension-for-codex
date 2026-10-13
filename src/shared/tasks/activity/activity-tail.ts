import { eventPayload } from "../../events/payload.js";
import type { Event } from "../../events/types.js";
import { activityFailed, activityKind } from "./activity-events.js";

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
 * get_user_agent_activity's result: the newest events after a cursor, and a
 * tally of the older events outside the window.
 */
export type ActivityPage = {
  events: Event[];
  /** Absent when no event has fallen outside the window. */
  dropped?: DroppedSummary;
};

/** Tally dropped events onto a running summary without mutating the previous one. */
export function addDropped(
  previous: DroppedSummary | undefined,
  dropped: Event[],
): DroppedSummary | undefined {
  const [first] = dropped;
  if (!first) return previous;

  const summary: DroppedSummary = previous
    ? { ...previous, tools: { ...previous.tools } }
    : {
        task_id: first.task_id,
        count: 0,
        from: first.timestamp,
        to: first.timestamp,
        toolCalls: 0,
        tools: {},
        messages: 0,
        failures: 0,
        retries: 0,
      };

  for (const event of dropped) {
    summary.count++;
    summary.to = event.timestamp;

    const started = eventPayload(event, "tool.started");

    if (started) {
      summary.toolCalls++;

      const name = started.name ?? "Tool";

      summary.tools[name] = (summary.tools[name] ?? 0) + 1;
    }

    const message = eventPayload(event, "agent.message");

    if (message) summary.messages++;

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
    ...(dropped ? { dropped } : {}),
  };
}

/**
 * get_user_agent_turn_activity's result: one turn's events, after the previous
 * turn closed through this turn's close, windowed and tallied like a page.
 */
export type TurnActivityPage = ActivityPage & { turn: number };

/**
 * The task status events that close a turn. The service writes one after
 * `task.turn_ended`, with any queue changes between, in the same transaction.
 */
export const TURN_CLOSING_EVENTS = [
  "task.completed",
  "task.failed",
  "task.interrupted",
  "task.queued",
];

/** Events that begin something else, so a closing event can't follow them. */
export const TURN_CLOSE_STOPS = ["task.started", "task.turn_ended"];

const isTurnEnded = (event: Event, turn: number) =>
  eventPayload(event, "task.turn_ended")?.turn === turn;

/**
 * The index of the event that closes a turn: its closing status event, or
 * its `task.turn_ended` when none follows; -1 when the turn has not ended.
 */
export function turnCloseIndex(events: Event[], turn: number) {
  const ended = events.findIndex((event) => isTurnEnded(event, turn));
  if (ended === -1) return -1;

  for (const [i, event] of events.entries()) {
    if (i <= ended) continue;
    if (TURN_CLOSE_STOPS.includes(event.type)) break;
    if (TURN_CLOSING_EVENTS.includes(event.type)) return i;
  }

  return ended;
}

/**
 * One turn's activity from an in-memory log. Matches the service's reads, for
 * fixtures. A turn that has not ended runs to the end of the log.
 */
export function windowTurnActivity(
  events: Event[],
  turn: number,
): TurnActivityPage {
  const previous = turnCloseIndex(events, turn - 1),
    end = turnCloseIndex(events, turn),
    range = events.slice(previous + 1, end === -1 ? undefined : end + 1),
    start = Math.max(0, range.length - EVENT_TAIL_SIZE),
    dropped = addDropped(undefined, range.slice(0, start));

  return {
    turn,
    events: range.slice(start),
    ...(dropped ? { dropped } : {}),
  };
}

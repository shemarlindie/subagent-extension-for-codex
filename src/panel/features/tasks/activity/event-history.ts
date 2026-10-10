import {
  type ActivityPage,
  type DroppedSummary,
  EVENT_TAIL_SIZE,
} from "../../../../shared/tasks/activity/activity-tail";
import type { Event } from "../../../app/state/types";
import { formatDuration } from "../list/duration";

export {
  addDropped,
  type DroppedSummary,
  EVENT_TAIL_SIZE,
} from "../../../../shared/tasks/activity/activity-tail";

/** The events and dropped tally the Activity tab shows for a task. */
export type ActivityView = { events: Event[]; dropped?: DroppedSummary };

/** The cursor for the next page: the last event the view shows for the task. */
export function activityCursor(events: Event[], taskId: string) {
  return events.filter((event) => event.task_id === taskId).at(-1)?.id ?? 0;
}

/**
 * Merges a page from get_user_agent_activity into the view. The page holds the
 * newest events after the cursor, so appending them and keeping the last
 * EVENT_TAIL_SIZE matches the service's window. The tally is the service's
 * own, so it replaces the previous one. Unchanged parts keep their identity,
 * so an unchanged view skips rendering.
 */
export function mergeActivity(
  previous: ActivityView,
  taskId: string,
  page: ActivityPage,
): ActivityView {
  const recent = previous.events.filter((event) => event.task_id === taskId),
    events = page.events.length
      ? [...recent, ...page.events].slice(-EVENT_TAIL_SIZE)
      : recent.length === previous.events.length
        ? previous.events
        : recent;

  const dropped =
    page.dropped &&
    JSON.stringify(page.dropped) === JSON.stringify(previous.dropped)
      ? previous.dropped
      : page.dropped;

  return { events, dropped };
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
    ].filter((part): part is string => Boolean(part)),
  };
}

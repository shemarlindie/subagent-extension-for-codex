import { eventPayload } from "../../events/payload.js";
import type { Event } from "../../events/types.js";
import { contentText } from "../../providers/activity/content-text.js";
import { activityPresentation } from "../../providers/activity/presentation.js";
import { scalarText } from "../../text.js";
import { failureMessage } from "../failure.js";

export type ActivityState = "running" | "completed" | "failed" | "info";

export type ActivityGroup = {
  id: string;
  kind: "message" | "tool" | "operation" | "status" | "stream" | "event";
  title: string;
  summary?: string;
  state: ActivityState;
  /** A group starts with its first event and only gains events. */
  events: [Event, ...Event[]];
};

/** The newest of a group's events. */
export const lastEvent = (events: ActivityGroup["events"]) =>
  events.at(-1) ?? events[0];

const words = (v: unknown) =>
  scalarText(v)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_.]/g, " ");

export const sentence = (v: unknown) => {
  const text = words(v);

  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const string = (v: unknown) => (typeof v === "string" ? v : undefined);

export const activityKind = (e: Event) =>
  activityPresentation(e).kind ?? e.type;

/**
 * The text of a worker reply. Activity shows it as a collapsible preview in
 * place of a summary.
 */
export const replyText = (e: Event) => eventPayload(e, "agent.reply")?.text;

export function activityFailed(e: Event) {
  const failed = activityPresentation(e).failed;
  if (failed !== undefined) return failed;

  if (
    eventPayload(e, "task.failed") ||
    eventPayload(e, "tool.completed")?.error === true ||
    eventPayload(e, "agent.completed")?.is_error === true ||
    Boolean(eventPayload(e, "task.interrupted")?.error) ||
    Boolean(eventPayload(e, "task.completed")?.error)
  ) {
    return true;
  }

  if (e.view.kind === "known") return false;

  const d = e.data;

  return (
    d.error === true ||
    d.is_error === true ||
    d.status === "failed" ||
    e.type === "task.failed" ||
    (typeof d.error === "string" && !!d.error)
  );
}

const quiet = new Set([
  "agent.started",
  "agent.turn_started",
  "task.started",
  "task.queued",
]);

export const boundaries = new Set([
  "task.turn_ended",
  "task.completed",
  "task.failed",
  "task.interrupted",
  "agent.completed",
  "task.started",
]);

/** Summaries for service events whose fields don't read as one. */
export function serviceSummary(e: Event) {
  const turnEnded = eventPayload(e, "task.turn_ended");

  if (turnEnded) {
    return `Turn ${turnEnded.turn} ${turnEnded.outcome}`;
  }

  const limited = eventPayload(e, "agent.limited");
  if (limited) return limited.reason;

  const queueChanged = eventPayload(e, "task.queue_changed");

  if (queueChanged) {
    const count = queueChanged.queue.length;

    return `${count} queued${queueChanged.paused ? " · paused" : ""}`;
  }

  return undefined;
}

/** Row titles for service events whose type doesn't read as one. */
const eventTitles: Partial<Record<string, string>> = {
  "agent.completed": "Turn completed",
  "agent.limited": "Session limited",
  "agent.reply": "Reply",
  "task.completed": "Task completed",
  "task.instruction": "Message",
  "task.session_started": "New session",
  "task.worktree_recreated": "Worktree recreated",
  "task.turn_ended": "Turn ended",
  "task.queue_changed": "Queue changed",
  "task.steer_taken": "Steer received",
  "task.message_removed": "Queued message removed",
};

/** States of task outcome events; other task events are informational. */
export const taskEventStates: Record<string, ActivityState> = {
  "task.failed": "failed",
  "task.completed": "completed",
};

export const thinking = new Set([
  "thinking_tokens",
  "thinking.tokens",
  "agent.thinking_tokens",
]);

export const isQuiet = (e: Event) =>
  activityPresentation(e).quiet ?? quiet.has(activityKind(e));

export function statusTitle(e: Event) {
  const presentation = activityPresentation(e);
  if (presentation.statusTitle) return presentation.statusTitle;
  if (thinkingSignal(e)) return "Thinking…";

  return (
    {
      "task.queued": "Queued",
      "task.started": "Task started",
      "agent.started": "Agent connected",
    }[e.type] ?? "Working"
  );
}

export function thinkingSignal(e: Event): boolean {
  return (
    !activityFailed(e) &&
    (activityPresentation(e).thinking ?? thinking.has(activityKind(e)))
  );
}

export function toolTitle(events: ActivityGroup["events"]) {
  const start = events.find((e) => eventPayload(e, "tool.started"));
  const started = start ? eventPayload(start, "tool.started") : undefined;
  const last = lastEvent(events);
  const operation = activityPresentation(last).operation;

  const opaqueData = last.view.kind === "known" ? {} : last.view.data;

  const name =
    started?.name ??
    eventPayload(last, "tool.completed")?.name ??
    string(opaqueData.tool_name) ??
    operation?.title ??
    "Tool";

  const input = started?.input ?? {};

  const target =
    typeof input.pattern === "string"
      ? [input.pattern, string(input.path)].filter(Boolean).join(" · ")
      : string(input.file_path ?? input.path ?? input.command);

  return {
    title: name,
    summary: target?.replace(/\s+/g, " ") ?? operation?.summary,
  };
}

// Prefer actionable error prose over tool paths and routine operation descriptions.
export function failureSummary(event: Event) {
  const opaqueData = event.view.kind === "known" ? {} : event.view.data;

  const tool = eventPayload(event, "tool.completed");
  const taskFailure = eventPayload(event, "task.failed");
  const interrupted = eventPayload(event, "task.interrupted");
  const taskCompleted = eventPayload(event, "task.completed");
  const agent = eventPayload(event, "agent.completed");

  const textOutput = contentText(tool?.content ?? opaqueData.content);

  return [
    taskFailure ? failureMessage(taskFailure) : undefined,
    interrupted?.error,
    taskCompleted?.error,
    agent?.result,
    opaqueData.error,
    opaqueData.message,
    opaqueData.stderr,
    opaqueData.output,
    textOutput,
    agent?.errors?.join("; "),
    Array.isArray(opaqueData.errors)
      ? opaqueData.errors.map(String).join("; ")
      : undefined,
  ].find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
}

/** Title of a service event row: a failure's title, else its presentation's, else its name. */
export function eventRowTitle(
  e: Event,
  key: string,
  presentationTitle: string | undefined,
) {
  if (!activityFailed(e)) {
    return (
      presentationTitle ??
      eventTitles[key] ??
      (thinkingSignal(e) ? "Thinking…" : sentence(key))
    );
  }

  if (key === "status") return statusTitle(e);

  return sentence(key === "agent.completed" ? "Agent failed" : key);
}

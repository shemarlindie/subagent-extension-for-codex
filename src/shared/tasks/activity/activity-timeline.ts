import type { Event } from "../../events/types.js";
import { activityPresentation } from "../../providers/activity/presentation.js";
import type { Task } from "../model.js";

export type ActivityState = "running" | "completed" | "failed" | "info";

export type ActivityGroup = {
  id: string;
  kind: "message" | "tool" | "operation" | "status" | "stream" | "event";
  title: string;
  summary?: string;
  state: ActivityState;
  events: Event[];
};

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

const words = (v: unknown) =>
  String(v ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_.]/g, " ");

const sentence = (v: unknown) => {
  const text = words(v);

  return text.charAt(0).toUpperCase() + text.slice(1);
};

const string = (v: unknown) => (typeof v === "string" ? v : undefined);

export const activityKind = (e: Event) =>
  activityPresentation(e).kind ?? e.type;

export function activityFailed(e: Event) {
  const failed = activityPresentation(e).failed;
  if (failed !== undefined) return failed;
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

const boundaries = new Set([
  "task.turn_ended",
  "task.completed",
  "task.failed",
  "task.interrupted",
  "agent.completed",
  "task.started",
]);

/** Summaries for service events whose fields don't read as one. */
function serviceSummary(e: Event) {
  const d = e.data;

  if (e.type === "task.turn_ended")
    return `Turn ${String(d.turn)} ${String(d.outcome)}`;

  if (e.type === "task.queue_changed") {
    const count = Array.isArray(d.queue) ? d.queue.length : 0;

    return `${count} queued${d.paused ? " · paused" : ""}`;
  }

  return undefined;
}

/** Row titles for service events whose type doesn't read as one. */
const eventTitles: Record<string, string> = {
  "parent.message": "Message queued for Codex",
  "parent.message_attempted": "Sending message to Codex",
  "parent.message_acknowledged": "Worker report acknowledged by Codex",
  "parent.message_delivery": "Codex message delivery result",
  "agent.completed": "Turn completed",
  "agent.reply": "Reply",
  "task.completed": "Task completed",
  "task.instruction": "Message",
  "task.session_started": "New session",
  "task.worktree_recreated": "Worktree recreated",
  "task.turn_ended": "Turn ended",
  "task.queue_changed": "Queue changed",
  "task.steer_taken": "Steer taken",
  "task.message_removed": "Queued message removed",
};

/** States of task outcome events; other task events are informational. */
const taskEventStates: Record<string, ActivityState> = {
  "task.failed": "failed",
  "task.completed": "completed",
};

const thinking = new Set([
  "thinking_tokens",
  "thinking.tokens",
  "agent.thinking_tokens",
]);

const isQuiet = (e: Event) =>
  activityPresentation(e).quiet ?? quiet.has(activityKind(e));

function statusTitle(e: Event) {
  // Older persisted presentations classified requesting as thinking.
  if (
    activityKind(e) === "status" &&
    e.data.status === "requesting" &&
    !activityFailed(e)
  )
    return "Requesting";
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

function thinkingSignal(e: Event): boolean {
  if (activityKind(e) === "status" && e.data.status === "requesting")
    return false;

  return (
    !activityFailed(e) &&
    (activityPresentation(e).thinking ?? thinking.has(activityKind(e)))
  );
}

function onlyThinkingSignals(group: ActivityGroup) {
  return group.events.length > 0 && group.events.every(thinkingSignal);
}

/**
 * When a thinking row started and ended, in epoch ms. A row that ends on a
 * thinking signal lasts until the task's next event (housekeeping events may
 * precede the first signal, so it starts there); `end: null` means nothing has
 * followed yet, so the caller decides whether it is still going. Other rows
 * have no span.
 */
export function thinkingSpan(
  group: ActivityGroup,
  events: Event[],
): { start: number; end: number | null } | undefined {
  const firstSignal = group.events.find(thinkingSignal),
    last = group.events.at(-1)!;

  if (!firstSignal) return undefined;
  const start = Date.parse(firstSignal.timestamp);

  if (thinkingSignal(last) && group.kind !== "message") {
    let next: Event | undefined;
    for (const e of events)
      if (
        e.task_id === last.task_id &&
        e.id > last.id &&
        (!next || e.id < next.id)
      )
        next = e;

    return { start, end: next ? Date.parse(next.timestamp) : null };
  }

  // A message that absorbed its thinking marker spans marker to message.
  if (group.kind === "message")
    return { start, end: Date.parse(last.timestamp) };

  return undefined;
}

function toolTitle(events: Event[]) {
  const start = events.find((e) => e.type === "tool.started");
  const last = events.at(-1)!;
  const operation = activityPresentation(last).operation;

  const name =
    string(start?.data.name) ??
    string(last.data.tool_name) ??
    operation?.title ??
    "Tool";

  const input = object(start?.data.input);

  const target =
    typeof input.pattern === "string"
      ? [input.pattern, string(input.path)].filter(Boolean).join(" · ")
      : string(input.file_path ?? input.path ?? input.command);

  return {
    title: name,
    summary: target?.replace(/\s+/g, " ") ?? operation?.summary,
  };
}

/** A tool result's text: its string content, or the text blocks of its content array. */
function resultText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;

  return content
    .filter((block) => object(block).type === "text")
    .map((block) => string(object(block).text))
    .filter(Boolean)
    .join("\n");
}

// Prefer actionable error prose over tool paths and routine operation descriptions.
function failureSummary(event: Event) {
  const d = event.data;

  const textOutput = resultText(d.content);

  return [
    d.error,
    d.message,
    d.stderr,
    d.output,
    textOutput,
    Array.isArray(d.errors) ? d.errors.map(String).join("; ") : undefined,
  ].find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
}

/** Title of a service event row: a failure's title, else its presentation's, else its name. */
function eventRowTitle(
  e: Event,
  key: string,
  presentationTitle: string | undefined,
) {
  if (!activityFailed(e))
    return (
      presentationTitle ??
      eventTitles[key] ??
      (thinkingSignal(e) ? "Thinking…" : sentence(key))
    );
  if (key === "status") return statusTitle(e);

  return sentence(key === "agent.completed" ? "Agent failed" : key);
}

/** Presentation only: every event remains in exactly one inspectable group. */
export function groupActivity(events: Event[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  const operations = new Map<string, ActivityGroup>();
  const messages = new Map<string, ActivityGroup>();
  const streams = new Map<string, ActivityGroup>();
  // A turn's result row, by task, until the service records the reply that repeats it.
  const completedTurns = new Map<string, ActivityGroup>();

  const add = (
    event: Event,
    kind: ActivityGroup["kind"],
    title: string,
    state: ActivityState = "info",
  ) => {
    const group: ActivityGroup = {
      id: `activity-${event.task_id}-${event.id}`,
      kind,
      title,
      state,
      events: [event],
    };

    groups.push(group);

    return group;
  };

  let adjacentStatus: ActivityGroup | undefined;
  let adjacentEvent: ActivityGroup | undefined;
  let adjacentThinking: ActivityGroup | undefined;

  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    const previousEvent = adjacentEvent;
    const previousThinking = adjacentThinking;
    // Even an event absorbed into a tool or message interrupts consecutive updates.
    adjacentEvent = undefined;
    adjacentThinking = undefined;

    const d = e.data,
      key = activityKind(e);

    if (!isQuiet(e) || activityFailed(e)) adjacentStatus = undefined;

    if (boundaries.has(key)) {
      for (const map of [operations, streams, messages]) {
        for (const [id, group] of map) {
          if (group.events[0].task_id !== e.task_id) continue;
          if (group.state === "running") group.state = "info";
          map.delete(id);
        }
      }
    }

    const presentation = activityPresentation(e);
    const operation = presentation.operation;

    let toolId: string | undefined;
    if (e.type.startsWith("tool.")) toolId = string(d.id);
    else if (operation?.kind === "tool")
      toolId = operation.id.replace(/^tool:/, "");

    let operationId: string | undefined;
    if (toolId) operationId = `tool:${e.task_id}:${toolId}`;
    else if (operation) operationId = `${e.task_id}:${operation.id}`;

    if (operationId) {
      let group = operations.get(operationId);
      if (!group || e.type === "tool.started" || operation?.started) {
        group = add(
          e,
          toolId ? "tool" : "operation",
          toolId ? "Tool" : (operation?.title ?? "Operation"),
          "running",
        );

        operations.set(operationId, group);
      } else group.events.push(e);
      const previousSummary = group.summary;
      if (toolId) Object.assign(group, toolTitle(group.events));
      else group.summary = operation?.summary ?? group.summary;

      const complete = e.type === "tool.completed" || operation?.completed;
      const stopped = operation?.stopped;

      if (activityFailed(e)) {
        group.state = "failed";

        group.summary =
          presentation.summary ?? failureSummary(e) ?? "Operation failed";
      } else if (group.state === "failed") {
        // Delayed progress must not erase the failure that already ended this operation.
        group.summary = previousSummary;
      } else if (stopped) {
        group.state = "info";
        const reason = operation?.summary;
        group.summary = `${d.outcome === "cancelled" ? "Cancelled" : "Stopped"}${reason ? ` · ${reason}` : ""}`;
      } else if (complete) group.state = "completed";
      continue;
    }

    if (presentation.stream) {
      const stream = presentation.stream,
        parent = `${e.task_id}:${stream.id}`;

      let group = streams.get(parent);
      if (!group || stream.started) {
        group = add(e, "stream", "Responding", "running");
        streams.set(parent, group);
        const id = stream.messageId;
        if (id) messages.set(`${e.task_id}:${id}`, group);
      } else group.events.push(e);

      if (stream.completed) {
        group.state = "completed";
        streams.delete(parent);
      }

      continue;
    }

    if (
      (e.type === "agent.message" || e.type === "agent.content") &&
      !activityFailed(e)
    ) {
      const nativeId = presentation.messageId;

      const id = nativeId ? `${e.task_id}:${nativeId}` : undefined;
      const existing = id ? messages.get(id) : undefined;
      let group: ActivityGroup;

      if (existing) {
        group = existing;
        existing.events.push(e);
        existing.kind = "message";
        existing.state = "completed";
        existing.title = d.role === "user" ? "You" : "Assistant";
      } else {
        group = add(
          e,
          "message",
          d.role === "user" ? "You" : "Assistant",
          "completed",
        );

        if (id) messages.set(id, group);
      }

      // A thinking marker immediately before an assistant message is
      // redundant when that message already contains its own thinking disclosure.
      // Keep the marker in the message's debug events so it remains inspectable.
      if (
        d.role !== "user" &&
        presentation.hasThinking &&
        previousThinking?.events[0].task_id === e.task_id &&
        onlyThinkingSignals(previousThinking)
      ) {
        const previousIndex = groups.indexOf(previousThinking);

        if (previousIndex >= 0 && previousThinking !== group) {
          group.events.push(...previousThinking.events);
          group.events.sort((a, b) => a.id - b.id);
          groups.splice(previousIndex, 1);
        }
      }

      continue;
    }

    if (e.type === "agent.reply") {
      const completed = completedTurns.get(e.task_id);
      completedTurns.delete(e.task_id);

      // Keep repeated result text on the reply row, not the completion row.
      if (completed && completed.summary === string(d.text))
        completed.summary = undefined;
    }

    if (isQuiet(e) && !activityFailed(e)) {
      const previous = adjacentStatus;
      // Startup and ordinary Claude status changes retain their own rows;
      // only thinking signals can become a Thought row.
      if (
        previous?.kind === "status" &&
        previous.events[0].task_id === e.task_id &&
        key !== "agent.started" &&
        !previous.events.some(
          (event) => activityKind(event) === "agent.started",
        ) &&
        !(key === "status" && !thinkingSignal(e)) &&
        !previous.events.some(
          (event) => activityKind(event) === "status" && !thinkingSignal(event),
        ) &&
        thinkingSignal(e) === onlyThinkingSignals(previous) &&
        (key === "rate_limit_event") ===
          (activityKind(previous.events.at(-1)!) === "rate_limit_event") &&
        !boundaries.has(key) &&
        !previous.events.some((event) => boundaries.has(activityKind(event)))
      ) {
        previous.events.push(e);
        previous.title = statusTitle(e);
      } else adjacentStatus = add(e, "status", statusTitle(e));
      if (adjacentStatus && onlyThinkingSignals(adjacentStatus))
        adjacentThinking = adjacentStatus;
      continue;
    }

    const group = add(
      e,
      "event",
      eventRowTitle(e, key, presentation.title),
      activityFailed(e) ? "failed" : "info",
    );

    group.summary =
      presentation.summary ??
      (activityFailed(e) ? failureSummary(e) : undefined) ??
      serviceSummary(e) ??
      string(
        d.text ??
          d.summary ??
          d.description ??
          d.message ??
          d.error ??
          d.result,
      ) ??
      (Array.isArray(d.errors) ? d.errors.map(String).join("; ") : undefined);

    if (e.type === "agent.reply" || thinkingSignal(e))
      group.summary = undefined;

    if (e.type === "agent.completed" && !activityFailed(e))
      completedTurns.set(e.task_id, group);
    else if (boundaries.has(key)) completedTurns.delete(e.task_id);

    // Generic updates need matching readable summaries; SDK messages and actionable
    // transitions retain their own rows. Every raw event remains inspectable.
    if (
      !activityFailed(e) &&
      !boundaries.has(key) &&
      key !== "assistant" &&
      key !== "user" &&
      key !== "agent.input_required" &&
      key !== "agent.input_submitted"
    ) {
      if (
        previousEvent &&
        previousEvent.events[0].task_id === e.task_id &&
        activityKind(previousEvent.events[0]) === key &&
        activityPresentation(previousEvent.events[0]).title ===
          presentation.title &&
        (thinkingSignal(e) ||
          (group.summary !== undefined &&
            previousEvent.summary === group.summary))
      ) {
        groups.pop();
        previousEvent.events.push(e);
        const count = previousEvent.events.length;

        previousEvent.title = thinkingSignal(e)
          ? "Thinking…"
          : `${presentation.title ?? sentence(key)} · ${count} events`;

        adjacentEvent = previousEvent;
      } else adjacentEvent = group;
      if (onlyThinkingSignals(adjacentEvent)) adjacentThinking = adjacentEvent;
    }
  }

  return groups;
}

/** Authoritative task state takes precedence over a retained tail's stale progress. */
export function currentActivityStatus(
  events: Event[],
  task?: Task,
): { text: string; state: ActivityState } {
  if (task) {
    if (task.status === "failed") return { text: "Failed", state: "failed" };
    if (task.status === "completed")
      return { text: "Completed", state: "completed" };
    if (task.status === "interrupted")
      return { text: sentence(task.status), state: "info" };
    if (task.status === "waiting" || task.pending_input)
      return {
        text: task.pending_input
          ? `Needs input · ${task.pending_input.tool}`
          : "Waiting",
        state: "info",
      };
    if (task.status === "queued" || task.status === "starting")
      return { text: sentence(task.status), state: "running" };
  }

  const sorted = [...events].sort((a, b) => a.id - b.id);
  const groups = groupActivity(sorted);

  const active = groups
    .filter((g) => g.state === "running")
    .sort((a, b) => a.events.at(-1)!.id - b.events.at(-1)!.id)
    .at(-1);

  const latest = sorted.findLast((e) => {
    const kind = activityKind(e);
    // Routine thinking updates must not hide live work or an earlier status change.
    if (active && thinkingSignal(e)) return false;

    return (
      [
        "task.failed",
        "task.completed",
        "task.interrupted",
        "agent.completed",
        "agent.input_required",
        "agent.input_submitted",
        "task.started",
        "agent.turn_started",
        ...thinking,
      ].includes(kind) ||
      (activityPresentation(e).liveStatus ??
        !!activityPresentation(e).statusTitle)
    );
  });

  if (latest && (!active || latest.id > active.events.at(-1)!.id)) {
    const kind = activityKind(latest);
    if (kind === "agent.input_required")
      return {
        text: `Needs input${latest.data.tool ? ` · ${latest.data.tool}` : ""}`,
        state: "info",
      };
    // A provider failure can arrive before the host persists its terminal task state.
    if (activityFailed(latest))
      return {
        text: kind === "status" ? statusTitle(latest) : "Failed",
        state: "failed",
      };
    if (kind === "agent.completed")
      return {
        text: task?.status === "running" ? "Finishing up" : "Turn completed",
        state: task?.status === "running" ? "running" : "completed",
      };
    if (
      ["task.started", "agent.turn_started", "agent.input_submitted"].includes(
        kind,
      )
    )
      return { text: "Working", state: "running" };
    if (kind.startsWith("task."))
      return {
        text: sentence(kind.slice(5)),
        state: taskEventStates[kind] ?? "info",
      };

    const presentation = activityPresentation(latest);
    if (presentation.statusState === "completed")
      return {
        text:
          task?.status === "running"
            ? "Finishing up"
            : (presentation.statusTitle ?? "Turn finished"),
        state: task ? "info" : "completed",
      };
    if (presentation.statusState)
      return { text: statusTitle(latest), state: presentation.statusState };

    return { text: statusTitle(latest), state: "running" };
  }

  if (active)
    return {
      text:
        active.kind === "tool"
          ? `Running ${active.title}${active.summary ? ` · ${active.summary}` : ""}`
          : active.title,
      state: "running",
    };

  return {
    text: events.length ? "Working" : "Waiting for worker activity",
    state: task ? "running" : "info",
  };
}

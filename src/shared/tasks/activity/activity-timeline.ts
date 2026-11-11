import { eventPayload } from "../../events/payload.js";
import type { Event } from "../../events/types.js";
import { contentText } from "../../providers/activity/content-text.js";
import { activityPresentation } from "../../providers/activity/presentation.js";
import {
  activityFailed,
  type ActivityGroup,
  activityKind,
  type ActivityState,
  boundaries,
  eventRowTitle,
  failureSummary,
  isQuiet,
  replyText,
  sentence,
  serviceSummary,
  statusTitle,
  string,
  thinkingSignal,
  toolTitle,
} from "./activity-events.js";

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
  const firstSignal = group.events.find(thinkingSignal);
  const last = group.events.at(-1)!;

  if (!firstSignal) return undefined;
  const start = Date.parse(firstSignal.timestamp);

  if (thinkingSignal(last) && group.kind !== "message") {
    let next: Event | undefined;

    for (const e of events) {
      if (
        e.task_id === last.task_id &&
        e.id > last.id &&
        (!next || e.id < next.id)
      ) {
        next = e;
      }
    }

    return { start, end: next ? Date.parse(next.timestamp) : null };
  }

  // A message that absorbed its thinking marker spans marker to message.
  if (group.kind === "message") {
    return { start, end: Date.parse(last.timestamp) };
  }

  return undefined;
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

    const key = activityKind(e);
    const d = e.view.kind === "known" ? {} : e.view.data;
    const toolStarted = eventPayload(e, "tool.started");
    const toolCompleted = eventPayload(e, "tool.completed");

    const message =
      eventPayload(e, "agent.message") ?? eventPayload(e, "agent.content");

    const reply = eventPayload(e, "agent.reply");

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

    if (e.type.startsWith("tool.")) {
      toolId = toolStarted?.id ?? toolCompleted?.id ?? string(d.id);
    } else if (operation?.kind === "tool") {
      toolId = operation.id.replace(/^tool:/, "");
    }

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
      } else {
        group.events.push(e);
      }

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
        const reason = operation.summary;
        group.summary = `${d.outcome === "cancelled" ? "Cancelled" : "Stopped"}${reason ? ` · ${reason}` : ""}`;
      } else if (complete) {
        group.state = "completed";
      }

      continue;
    }

    if (presentation.stream) {
      const stream = presentation.stream;
      const parent = `${e.task_id}:${stream.id}`;

      let group = streams.get(parent);

      if (!group || stream.started) {
        group = add(e, "stream", "Responding", "running");
        streams.set(parent, group);
        const id = stream.messageId;
        if (id) messages.set(`${e.task_id}:${id}`, group);
      } else {
        group.events.push(e);
      }

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
        existing.title = message?.role === "user" ? "You" : "Assistant";
      } else {
        group = add(
          e,
          "message",
          message?.role === "user" ? "You" : "Assistant",
          "completed",
        );

        if (id) messages.set(id, group);
      }

      // A thinking marker immediately before an assistant message is
      // redundant when that message already contains its own thinking disclosure.
      // Keep the marker in the message's debug events so it remains inspectable.
      if (
        message?.role !== "user" &&
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

    if (reply) {
      const completed = completedTurns.get(e.task_id);
      completedTurns.delete(e.task_id);

      // Keep repeated result text on the reply row, not the completion row.
      if (completed && completed.summary === reply.text) {
        completed.summary = undefined;
      }
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
      } else {
        adjacentStatus = add(e, "status", statusTitle(e));
      }

      if (adjacentStatus && onlyThinkingSignals(adjacentStatus)) {
        adjacentThinking = adjacentStatus;
      }

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
      eventPayload(e, "agent.completed")?.result ??
      eventPayload(e, "task.instruction")?.message ??
      (toolCompleted ? contentText(toolCompleted.content) : undefined) ??
      string(
        d.text ??
          d.summary ??
          d.description ??
          d.message ??
          d.error ??
          d.result,
      ) ??
      (Array.isArray(d.errors) ? d.errors.map(String).join("; ") : undefined);

    // Replies carry their own text, so no summary repeats it.
    if (replyText(e) !== undefined || thinkingSignal(e)) {
      group.summary = undefined;
    }

    if (e.type === "agent.completed" && !activityFailed(e)) {
      completedTurns.set(e.task_id, group);
    } else if (boundaries.has(key)) {
      completedTurns.delete(e.task_id);
    }

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
      } else {
        adjacentEvent = group;
      }

      if (onlyThinkingSignals(adjacentEvent)) adjacentThinking = adjacentEvent;
    }
  }

  return groups;
}

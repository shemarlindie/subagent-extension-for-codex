import type { Event, Task } from "./types";

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
  e.type === "claude.activity" ? String(e.data.subtype ?? e.data.type) : e.type;
export function activityFailed(e: Event) {
  const d = e.data;
  return (
    d.error === true ||
    d.is_error === true ||
    d.outcome === "error" ||
    d.compact_result === "failed" ||
    d.status === "failed" ||
    object(d.patch).status === "failed" ||
    [
      "task.failed",
      "artifact.error",
      "permission_denied",
      "mirror_error",
    ].includes(activityKind(e)) ||
    (typeof d.error === "string" &&
      !!d.error &&
      activityKind(e) !== "api_retry") ||
    (e.type === "agent.completed" &&
      typeof d.subtype === "string" &&
      d.subtype !== "success")
  );
}
const quiet = new Set([
  "agent.started",
  "agent.turn_started",
  "task.started",
  "task.queued",
  "task.continued",
  "init",
  "status",
  "session_state_changed",
  "api_retry",
  "auth_status",
  "rate_limit_event",
  "compact_boundary",
  "files_persisted",
  "plugin_install",
  "elicitation_complete",
]);
const boundaries = new Set([
  "task.completed",
  "task.failed",
  "task.interrupted",
  "task.cancelled",
  "agent.completed",
  "task.started",
  "task.continued",
]);
function statusTitle(e: Event) {
  const key = activityKind(e),
    d = e.data;
  if (key === "status")
    return d.compact_result === "failed"
      ? "Context compaction failed"
      : d.status === "compacting"
        ? "Compacting context"
        : d.status === "requesting"
          ? "Thinking"
          : "Working";
  if (key === "api_retry")
    return `Retrying request${typeof d.attempt === "number" ? ` · attempt ${d.attempt}` : ""}`;
  if (key === "compact_boundary") return "Context compacted";
  if (key === "auth_status")
    return d.isAuthenticating
      ? "Connecting to Claude"
      : "Authentication updated";
  if (key === "session_state_changed")
    return d.state === "requires_action"
      ? "Needs input"
      : d.state === "idle"
        ? "Turn finished"
        : "Working";
  if (key === "rate_limit_event")
    return object(d.rate_limit_info).status === "rejected"
      ? "Waiting for rate limit reset"
      : "Rate limit updated";
  if (key === "files_persisted") return "Files saved";
  if (key === "plugin_install") return "Updating plugins";
  if (key === "task.queued") return "Queued";
  if (["agent.started", "init"].includes(key)) return "Claude connected";
  return "Working";
}
function toolTitle(events: Event[]) {
  const start = events.find((e) => e.type === "tool.started");
  const last = events.at(-1)!;
  const name =
    string(start?.data.name) ?? string(last.data.tool_name) ?? "Tool";
  const input = object(start?.data.input);
  const target =
    typeof input.pattern === "string"
      ? [input.pattern, string(input.path)].filter(Boolean).join(" · ")
      : string(input.file_path ?? input.path ?? input.command);
  return { title: name, summary: target?.replace(/\s+/g, " ") };
}

// Prefer actionable error prose over tool paths and routine operation descriptions.
function failureSummary(event: Event) {
  const d = event.data;
  const textOutput =
    typeof d.content === "string"
      ? d.content
      : Array.isArray(d.content)
        ? d.content
            .filter((block) => object(block).type === "text")
            .map((block) => string(object(block).text))
            .filter(Boolean)
            .join("\n")
        : undefined;
  return [
    d.compact_error,
    d.error,
    object(d.patch).error,
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

/** Presentation only: every event remains in exactly one inspectable group. */
export function groupActivity(events: Event[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  const operations = new Map<string, ActivityGroup>();
  const messages = new Map<string, ActivityGroup>();
  const streams = new Map<string, ActivityGroup>();
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
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    const d = e.data,
      key = activityKind(e);
    if (!quiet.has(key) || activityFailed(e)) adjacentStatus = undefined;
    if (boundaries.has(key)) {
      for (const map of [operations, streams, messages]) {
        for (const [id, group] of map) {
          if (group.events[0].task_id !== e.task_id) continue;
          if (group.state === "running") group.state = "info";
          map.delete(id);
        }
      }
    }
    const toolId = e.type.startsWith("tool.")
      ? string(d.id)
      : key === "tool_progress"
        ? string(d.tool_use_id)
        : undefined;
    const operationId = toolId
      ? `tool:${e.task_id}:${toolId}`
      : key.startsWith("hook_") && d.hook_id
        ? `hook:${e.task_id}:${d.hook_id}`
        : key.startsWith("task_") && d.task_id
          ? `background:${e.task_id}:${d.task_id}`
          : undefined;
    if (operationId) {
      let group = operations.get(operationId);
      if (
        !group ||
        e.type === "tool.started" ||
        key === "hook_started" ||
        key === "task_started"
      ) {
        group = add(
          e,
          toolId ? "tool" : "operation",
          toolId
            ? "Tool"
            : key.startsWith("hook_")
              ? `Hook · ${d.hook_name ?? "Hook"}`
              : "Background task",
          "running",
        );
        operations.set(operationId, group);
      } else group.events.push(e);
      const previousSummary = group.summary;
      if (toolId) Object.assign(group, toolTitle(group.events));
      else
        group.summary =
          string(d.description ?? d.summary ?? object(d.patch).description) ??
          group.summary;
      const complete =
        e.type === "tool.completed" ||
        key === "hook_response" ||
        key === "task_notification" ||
        ["completed", "stopped"].includes(
          String(d.status ?? object(d.patch).status),
        );
      const stopped =
        d.outcome === "cancelled" ||
        ["stopped", "killed"].includes(
          String(d.status ?? object(d.patch).status),
        );
      if (activityFailed(e)) {
        group.state = "failed";
        group.summary = failureSummary(e) ?? "Operation failed";
      } else if (group.state === "failed") {
        // Delayed progress must not erase the failure that already ended this operation.
        group.summary = previousSummary;
      } else if (stopped) {
        group.state = "info";
        const reason = string(d.summary ?? object(d.patch).description);
        group.summary = `${d.outcome === "cancelled" ? "Cancelled" : "Stopped"}${reason ? ` · ${reason}` : ""}`;
      } else if (complete) group.state = "completed";
      continue;
    }
    if (key === "stream_event") {
      const frame = object(d.event),
        parent = `${e.task_id}:${d.parent_tool_use_id ?? "root"}`;
      let group = streams.get(parent);
      if (!group || frame.type === "message_start") {
        group = add(e, "stream", "Responding", "running");
        streams.set(parent, group);
        const id = string(object(frame.message).id);
        if (id) messages.set(`${e.task_id}:${id}`, group);
      } else group.events.push(e);
      if (frame.type === "message_stop") {
        group.state = "completed";
        streams.delete(parent);
      }
      continue;
    }
    if (
      (e.type === "agent.message" || e.type === "agent.content") &&
      !activityFailed(e)
    ) {
      const raw = object(d.raw_response),
        nativeId = string(object(raw.message).id ?? raw.uuid);
      const id = nativeId ? `${e.task_id}:${nativeId}` : undefined;
      const existing = id ? messages.get(id) : undefined;
      if (existing) {
        existing.events.push(e);
        existing.kind = "message";
        existing.state = "completed";
        existing.title = d.role === "user" ? "You" : "Assistant";
      } else {
        const group = add(
          e,
          "message",
          d.role === "user" ? "You" : "Assistant",
          "completed",
        );
        if (id) messages.set(id, group);
      }
      continue;
    }
    if (quiet.has(key) && !activityFailed(e)) {
      const previous = adjacentStatus;
      // Only adjacent housekeeping bursts combine; messages remain in sequence.
      if (
        previous?.kind === "status" &&
        previous.events[0].task_id === e.task_id
      ) {
        previous.events.push(e);
        previous.title = statusTitle(e);
      } else adjacentStatus = add(e, "status", statusTitle(e));
      continue;
    }
    const group = add(
      e,
      "event",
      activityFailed(e)
        ? key === "status"
          ? statusTitle(e)
          : sentence(key === "agent.completed" ? "Agent failed" : key)
        : key === "agent.completed"
          ? "Turn completed"
          : key === "task.completed"
            ? "Task completed"
            : sentence(key),
      activityFailed(e) ? "failed" : "info",
    );
    group.summary =
      (activityFailed(e) ? failureSummary(e) : undefined) ??
      string(
        d.compact_error ??
          object(d.structured_output).summary ??
          d.text ??
          d.summary ??
          d.description ??
          d.message ??
          d.error ??
          d.result,
      ) ??
      (Array.isArray(d.errors) ? d.errors.map(String).join("; ") : undefined);
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
    if (task.status === "cancelled" || task.status === "interrupted")
      return { text: sentence(task.status), state: "info" };
    if (task.status === "waiting" || task.pending_input)
      return {
        text:
          task.waiting_reason === "termination_unconfirmed"
            ? "Shutdown unconfirmed"
            : task.pending_input
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
  const latest = sorted.findLast((e) =>
    [
      "task.failed",
      "task.completed",
      "task.cancelled",
      "task.interrupted",
      "agent.completed",
      "agent.input_required",
      "agent.input_submitted",
      "task.started",
      "task.continued",
      "agent.turn_started",
      "status",
      "api_retry",
      "session_state_changed",
      "rate_limit_event",
    ].includes(activityKind(e)),
  );
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
      [
        "task.started",
        "task.continued",
        "agent.turn_started",
        "agent.input_submitted",
      ].includes(kind)
    )
      return { text: "Working", state: "running" };
    if (kind.startsWith("task."))
      return {
        text: sentence(kind.slice(5)),
        state:
          kind === "task.failed"
            ? "failed"
            : kind === "task.completed"
              ? "completed"
              : "info",
      };
    if (kind === "session_state_changed") {
      if (latest.data.state === "requires_action")
        return { text: "Needs input", state: "info" };
      if (latest.data.state === "idle")
        return {
          text: task?.status === "running" ? "Finishing up" : "Turn finished",
          state: task ? "info" : "completed",
        };
    }
    if (
      kind === "rate_limit_event" &&
      object(latest.data.rate_limit_info).status === "rejected"
    )
      return { text: statusTitle(latest), state: "info" };
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

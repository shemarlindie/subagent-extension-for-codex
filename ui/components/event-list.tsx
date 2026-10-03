import { useId, useState } from "react";
import type { Event, Task } from "../core/types";
import {
  groupActivity,
  currentActivityStatus,
  activityFailed,
  type ActivityGroup,
} from "../core/activity-timeline";
import { EVENT_TAIL_SIZE } from "../core/event-history";
import {
  ActivityContent,
  ActivityValue,
  label,
  record,
} from "./activity-content";

const titles: Record<string, string> = {
  init: "Claude connected",
  status: "Claude status",
  compact_boundary: "Context compacted",
  api_retry: "Retrying API request",
  local_command_output: "Command output",
  hook_started: "Hook started",
  hook_progress: "Hook progress",
  hook_response: "Hook finished",
  task_started: "Background task started",
  task_updated: "Background task updated",
  task_progress: "Background task progress",
  task_notification: "Background task finished",
  session_state_changed: "Session state changed",
  notification: "Notification",
  files_persisted: "Files saved",
  memory_recall: "Recalled from memory",
  plugin_install: "Plugin installation",
  elicitation_complete: "Input completed",
  permission_denied: "Permission denied",
  mirror_error: "Transcript sync failed",
  tool_progress: "Tool running",
  tool_use_summary: "Tool summary",
  auth_status: "Authentication",
  rate_limit_event: "Rate limit update",
  prompt_suggestion: "Suggested next prompt",
  assistant: "Claude response",
  user: "User message",
  stream_event: "Response streaming",
};
const envelope = new Set([
  "raw_response",
  "type",
  "subtype",
  "uuid",
  "session_id",
  "parent_tool_use_id",
]);
function sdkTitle(data: Record<string, unknown>) {
  const key = String(data.subtype ?? data.type ?? "activity");
  return titles[key] ?? label(key);
}
function RawResponse({ event }: { event: Event }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="activity-raw"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Raw response</summary>
      {open && (
        <pre data-scroll={`event-${event.id}`}>
          {JSON.stringify(event.data.raw_response ?? event.data, null, 2)}
        </pre>
      )}
    </details>
  );
}
function EventBody({ event }: { event: Event }) {
  const d = event.data;
  if (event.type === "agent.message")
    return <ActivityContent content={d.content ?? d.text} />;
  if (event.type === "agent.content")
    return <ActivityContent content={d.content ?? d.text} />;
  if (event.type === "tool.started") return <ActivityValue value={d.input} />;
  if (event.type === "tool.completed")
    return <ActivityContent content={d.content ?? d.text} />;
  if (event.type === "claude.activity" && d.type === "stream_event") {
    const stream = record(d.event);
    return (
      <>
        <p className="muted">{label(String(stream.type ?? "Streaming"))}</p>
        {stream.delta ? (
          <ActivityContent content={stream.delta} />
        ) : stream.content_block ? (
          <ActivityContent content={stream.content_block} />
        ) : (
          <ActivityValue
            value={Object.fromEntries(
              Object.entries(stream).filter(([key]) => key !== "type"),
            )}
          />
        )}
      </>
    );
  }
  if (
    event.type === "claude.activity" &&
    (d.type === "assistant" || d.type === "user")
  )
    return (
      <>
        <ActivityContent content={record(d.message).content} />
        {d.error != null && <p className="error">{String(d.error)}</p>}
      </>
    );
  const proseKeys = [
    "text",
    "summary",
    "description",
    "suggestion",
    "result",
    "content",
  ];
  const prose = proseKeys.filter((key) => typeof d[key] === "string");
  return (
    <>
      {prose.map((key) => (
        <ActivityContent key={key} content={d[key]} />
      ))}
      <ActivityValue
        value={Object.fromEntries(
          Object.entries(d).filter(
            ([key]) =>
              !envelope.has(key) &&
              !prose.includes(key) &&
              !(key === "total_cost_usd" && d.cost_usd !== undefined),
          ),
        )}
      />
    </>
  );
}
function EventCard({ event, toolName }: { event: Event; toolName?: string }) {
  const d = event.data;
  const failed = activityFailed(event);
  const title =
    event.type === "claude.activity"
      ? sdkTitle(d)
      : event.type === "agent.message"
        ? "Worker message"
        : event.type === "agent.content"
          ? d.role === "user"
            ? "User content"
            : "Claude content"
          : event.type === "tool.started"
            ? `${d.name ?? "Tool"} started`
            : event.type === "tool.completed"
              ? `${toolName ?? "Tool"} ${failed ? "failed" : "completed"}`
              : event.type === "agent.started"
                ? "Agent started"
                : event.type === "agent.completed"
                  ? `Agent ${failed ? "failed" : "finished"}`
                  : label(event.type);
  return (
    <article className={`event${failed ? " activity-error" : ""}`}>
      <time dateTime={event.timestamp}>
        {new Date(event.timestamp).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </time>
      <div className="activity-body">
        <strong>{title}</strong>
        <EventBody event={event} />
        <RawResponse event={event} />
      </div>
    </article>
  );
}
export function EventDetails({ events }: { events: Event[] }) {
  const toolNames = new Map(
    events
      .filter((e) => e.type === "tool.started")
      .map((e) => [e.data.id, String(e.data.name ?? "Tool")]),
  );
  return (
    <>
      {events.length === EVENT_TAIL_SIZE && (
        <p className="help">
          Showing the most recent {EVENT_TAIL_SIZE} events.
        </p>
      )}
      {events.length ? (
        [...events]
          .reverse()
          .map((event) => (
            <EventCard
              key={event.id}
              event={event}
              toolName={toolNames.get(event.data.id)}
            />
          ))
      ) : (
        <p className="muted">Waiting for worker activity.</p>
      )}
    </>
  );
}

function StreamContent({ group }: { group: ActivityGroup }) {
  const blocks = new Map<number, Record<string, unknown>>();
  for (const event of group.events) {
    const frame = record(event.data.event),
      index = frame.index ?? 0;
    if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0)
      continue;
    if (frame.type === "content_block_start")
      blocks.set(index, { ...record(frame.content_block) });
    if (frame.type === "content_block_delta") {
      const delta = record(frame.delta),
        block = blocks.get(index) ?? {};
      if (delta.type === "text_delta") {
        block.type = "text";
        block.text = String(block.text ?? "") + String(delta.text ?? "");
      }
      if (delta.type === "thinking_delta") {
        block.type = "thinking";
        block.thinking =
          String(block.thinking ?? "") + String(delta.thinking ?? "");
      }
      if (delta.type === "input_json_delta") {
        block.type = "input_json_delta";
        block.partial_json =
          String(block.partial_json ?? "") + String(delta.partial_json ?? "");
      }
      blocks.set(index, block);
    }
  }
  return <ActivityContent content={[...blocks.values()]} />;
}
function GroupCard({ group }: { group: ActivityGroup }) {
  const [debugOpen, setDebugOpen] = useState(false);
  // Avoid hidden content work until inspection; retain it afterward to keep disclosures open.
  const [debugMounted, setDebugMounted] = useState(false);
  const debugId = useId();
  const conversational = group.kind === "message" || group.kind === "stream";
  const contentEvents = group.events.filter(
    (e) => e.type === "agent.message" || e.type === "agent.content",
  );
  const badge =
    group.state === "running"
      ? "Running"
      : group.state === "failed"
        ? "Failed"
        : group.state === "completed" && !conversational
          ? "Done"
          : undefined;
  return (
    <article
      className={`activity-group activity-${group.kind}${group.state === "failed" ? " activity-error" : ""}`}
    >
      <div className="activity-group-heading">
        <span
          className={`activity-dot activity-dot-${group.state}`}
          aria-hidden="true"
        />
        <strong>{group.title}</strong>
        {badge && <span className="activity-badge">{badge}</span>}
        <time dateTime={group.events[0].timestamp}>
          {new Date(group.events[0].timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
        <button
          type="button"
          className="activity-debug-toggle"
          aria-label={`Debug activity: ${group.title}`}
          title={`Inspect ${group.events.length} raw ${group.events.length === 1 ? "response" : "responses"}`}
          aria-expanded={debugOpen}
          aria-controls={debugId}
          onClick={() => {
            setDebugMounted(true);
            setDebugOpen((open) => !open);
          }}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m8 3 2 3m6-3-2 3M9 9h6M12 9v11M4 7l3 3m13-3-3 3M3 13h4m10 0h4M4 19l3-3m13 3-3-3" />
            <rect x="7" y="6" width="10" height="14" rx="5" />
          </svg>
        </button>
      </div>
      {group.summary && (
        <p className="activity-group-summary" title={group.summary}>
          {group.summary}
        </p>
      )}
      {conversational && (
        <div className="activity-body">
          {contentEvents.length ? (
            contentEvents.map((event) => (
              <EventBody key={event.id} event={event} />
            ))
          ) : (
            <StreamContent group={group} />
          )}
        </div>
      )}
      <div id={debugId} className="activity-debug-panel" hidden={!debugOpen}>
        {debugMounted && (
          <>
            <p className="activity-debug-caption">
              Debug details · {group.events.length}{" "}
              {group.events.length === 1 ? "event" : "events"}
            </p>
            <EventDetails events={group.events} />
          </>
        )}
      </div>
    </article>
  );
}
export function EventList({ events, task }: { events: Event[]; task?: Task }) {
  const groups = groupActivity(events),
    current = currentActivityStatus(events, task);
  return (
    <section className="activity-timeline" aria-label="Worker activity">
      <div className="activity-current" role="status">
        <span
          className={`activity-dot activity-dot-${current.state}`}
          aria-hidden="true"
        />
        <span>{current.text}</span>
      </div>
      {events.length === EVENT_TAIL_SIZE && (
        <p className="help">
          Showing the most recent {EVENT_TAIL_SIZE} events.
        </p>
      )}
      {groups.map((group) => (
        <GroupCard key={group.id} group={group} />
      ))}
    </section>
  );
}

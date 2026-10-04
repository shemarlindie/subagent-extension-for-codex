import { memo, useId, useState } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import type { Event } from "../core/types";
import {
  groupActivity,
  activityFailed,
  thinkingSpan,
  type ActivityGroup,
} from "../core/activity-timeline";
import { formatDuration } from "../core/duration";
import { useNow } from "./use-now";
import {
  EVENT_TAIL_SIZE,
  describeDropped,
  type DroppedSummary,
} from "../core/event-history";
import { useActivityScroll } from "./use-activity-scroll";
import { Timeline, TimelineDot, TimelineItem } from "./timeline";
import { MotionContent, Presence } from "./motion";
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
function RawResponse({
  event,
  defaultOpen,
}: {
  event: Event;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <details
      className="activity-raw"
      open={open}
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
function EventCard({
  event,
  toolName,
  rawOnly,
  expandRaw,
}: {
  event: Event;
  toolName?: string;
  rawOnly?: boolean;
  expandRaw?: boolean;
}) {
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
        {!rawOnly && <strong>{title}</strong>}
        {!rawOnly && <EventBody event={event} />}
        <RawResponse event={event} defaultOpen={expandRaw} />
      </div>
    </article>
  );
}
/** `rawOnly` skips the title and rendered body when the group already shows them and opens the newest raw response. */
export function EventDetails({
  events,
  rawOnly,
}: {
  events: Event[];
  rawOnly?: boolean;
}) {
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
          .map((event, index) => (
            <EventCard
              key={event.id}
              event={event}
              toolName={toolNames.get(event.data.id)}
              rawOnly={rawOnly}
              expandRaw={rawOnly && index === 0}
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
const isThinkingBlock = (block: unknown) => {
  const type = record(block).type;
  return type === "thinking" || type === "redacted_thinking";
};
/** True when every message in the group holds only thinking blocks. */
function thinkingOnly(events: Event[]) {
  return (
    events.length > 0 &&
    events.every((e) => {
      // The provider emits one content block per event; accept arrays too.
      const content = e.data.content ?? e.data.text;
      const blocks = Array.isArray(content) ? content : [content];
      return blocks.length > 0 && blocks.every(isThinkingBlock);
    })
  );
}
// Continues the "Showing the most recent N events" sentence with what was left out.
function DroppedNote({ summary }: { summary: DroppedSummary }) {
  const { headline, details } = describeDropped(summary);
  return (
    <>
      {" "}
      {headline}
      {details.length > 0 && <span> {details.join(" · ")}.</span>}
    </>
  );
}
// Only this component ticks, so a running thinking row never re-renders the list.
function ThinkingClock({ start }: { start: number }) {
  const elapsed = useNow(true) - start;
  if (elapsed < 1000) return null;
  return (
    <span className="activity-badge activity-duration">
      {formatDuration(elapsed)}
    </span>
  );
}
function GroupCard({
  group,
  first,
  last,
  span,
  running,
}: {
  group: ActivityGroup;
  first: boolean;
  last: boolean;
  span?: { start: number; end: number | null };
  running: boolean;
}) {
  const [debugOpen, setDebugOpen] = useState(false);
  // Avoid hidden content work until inspection; retain it afterward to keep disclosures open.
  const [debugMounted, setDebugMounted] = useState(false);
  const debugId = useId();
  const conversational = group.kind === "message" || group.kind === "stream";
  // Messages, and event/status rows with a summary, already show their text above;
  // tools and operations keep the structured debug body for their input and output.
  const showsOwnText =
    conversational ||
    ((group.kind === "event" || group.kind === "status") &&
      group.summary !== undefined);
  const contentEvents = group.events.filter(
    (e) => e.type === "agent.message" || e.type === "agent.content",
  );
  // Thinking-only messages read as a quiet "Thinking" row, not an assistant reply.
  // Their text is mostly empty, so it is only shown through the debug view.
  const quietThinking = conversational && thinkingOnly(contentEvents);
  // The heading and the debug toggle's label name the row the same way.
  // A finished thinking row states its duration in place of "Thinking…".
  const thoughtMs =
    span?.end != null && (group.kind !== "message" || quietThinking)
      ? span.end - span.start
      : undefined;
  const title =
    thoughtMs !== undefined
      ? thoughtMs >= 1000
        ? `Thought for ${formatDuration(thoughtMs)}`
        : "Thought"
      : quietThinking
        ? "Thinking"
        : group.title;
  const badge =
    group.state === "running"
      ? "Running"
      : group.state === "failed"
        ? "Failed"
        : group.state === "completed" && !conversational
          ? "Done"
          : undefined;
  return (
    <Collapsible.Root
      render={
        <TimelineItem
          render={<article />}
          status={group.state}
          first={first}
          last={last}
        />
      }
      open={debugOpen}
      onOpenChange={setDebugOpen}
      data-activity-id={group.id}
      className={`activity-group activity-${group.kind}${quietThinking ? " activity-thinking-only" : ""}${group.state === "failed" ? " activity-error" : ""}`}
    >
      <div className="activity-group-heading">
        <TimelineDot />
        {/* One line box so the smaller badge shares the title's baseline. */}
        <span className="activity-group-title">
          <MotionContent as="strong" changeKey={title}>
            {title}
          </MotionContent>
          {badge && (
            <MotionContent changeKey={badge} className="activity-badge">
              {badge}
            </MotionContent>
          )}
          {span?.end === null && running && (
            <ThinkingClock start={span.start} />
          )}
        </span>
        <time dateTime={group.events[0].timestamp}>
          {new Date(group.events[0].timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
        <Collapsible.Trigger
          className="activity-debug-toggle"
          aria-label={`Debug activity: ${title}`}
          aria-controls={debugId}
          title={`Inspect ${group.events.length} raw ${group.events.length === 1 ? "response" : "responses"}`}
          onClick={() => setDebugMounted(true)}
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
        </Collapsible.Trigger>
      </div>
      {group.summary && (
        <p className="activity-group-summary" title={group.summary}>
          {group.summary}
        </p>
      )}
      {conversational && !quietThinking && (
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
      {/* Always mounted so the toggle's aria-controls resolves while closed. */}
      <Collapsible.Panel
        keepMounted
        id={debugId}
        className="activity-debug-panel collapse-panel"
      >
        {debugMounted && (
          <div className="activity-debug-body">
            <p className="activity-debug-caption">
              Debug details · {group.events.length}{" "}
              {group.events.length === 1 ? "event" : "events"}
            </p>
            <EventDetails events={group.events} rawOnly={showsOwnText} />
          </div>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
// Polls keep the same events array when nothing changed, so a hidden tab skips work.
export const EventList = memo(function EventList({
  events,
  active,
  running = false,
  dropped,
}: {
  events: Event[];
  active?: boolean;
  /** What fell off the front of `events`, tallied by the event reader. */
  dropped?: DroppedSummary;
  /** The worker is mid-turn, so a thinking row with nothing after it is still going. */
  running?: boolean;
}) {
  const groups = groupActivity(events).sort(
    (a, b) => b.events.at(-1)!.id - a.events.at(-1)!.id,
  );
  const { viewportRef, pinned, scrollToTop } = useActivityScroll(
    events,
    active,
  );
  return (
    <section className="activity-timeline" aria-label="Worker activity">
      <div
        ref={viewportRef}
        className="activity-viewport"
        tabIndex={0}
        role="region"
        aria-label="Activity history"
      >
        <Timeline trimmed={events.length === EVENT_TAIL_SIZE}>
          {groups.map((group, index) => (
            <GroupCard
              key={group.id}
              group={group}
              first={index === 0}
              last={index === groups.length - 1}
              span={thinkingSpan(group, events)}
              running={running}
            />
          ))}
        </Timeline>
        {/* Sits where the rail fades out, since the oldest rows are the ones dropped. */}
        {events.length === EVENT_TAIL_SIZE && (
          <p className="help activity-trimmed-note">
            Showing the most recent {EVENT_TAIL_SIZE} events.
            {dropped && dropped.task_id === events[0].task_id && (
              <DroppedNote summary={dropped} />
            )}
          </p>
        )}
      </div>
      <Presence show={!pinned} variant="pop">
        <button
          type="button"
          className="activity-scroll-top"
          aria-label="Scroll to latest activity"
          title="Scroll to latest activity"
          onClick={scrollToTop}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m6 12 6-6 6 6M12 6v12" />
          </svg>
        </button>
      </Presence>
    </section>
  );
});

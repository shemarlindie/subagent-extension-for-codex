import { useState } from "react";
import type { Event } from "../core/types";
import { activityFailed } from "../core/activity-timeline";
import { EVENT_TAIL_SIZE } from "../core/event-history";
import { ActivityContent } from "./activity-content";
import { ActivityValue } from "./activity-value";
import { ActivityTime } from "./activity-time";
import { eventTitle, label, record } from "../utils/activity";

const envelope = new Set([
  "raw_response",
  "type",
  "subtype",
  "uuid",
  "session_id",
  "parent_tool_use_id",
]);

interface RawResponseProps {
  event: Event;
  defaultOpen?: boolean;
}

function RawResponse({ event, defaultOpen }: RawResponseProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <details
      className="activity-raw"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
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

export function EventBody({ event }: { event: Event }) {
  const data = event.data;
  if (event.type === "agent.message" || event.type === "agent.content")
    return <ActivityContent content={data.content ?? data.text} />;
  if (event.type === "tool.started")
    return <ActivityValue value={data.input} />;
  if (event.type === "tool.completed")
    return <ActivityContent content={data.content ?? data.text} />;

  if (event.type === "claude.activity" && data.type === "stream_event") {
    const stream = record(data.event);

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
    (data.type === "assistant" || data.type === "user")
  )
    return (
      <>
        <ActivityContent content={record(data.message).content} />
        {data.error != null && <p className="error">{String(data.error)}</p>}
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

  const prose = proseKeys.filter((key) => typeof data[key] === "string");

  return (
    <>
      {prose.map((key) => (
        <ActivityContent key={key} content={data[key]} />
      ))}
      <ActivityValue
        value={Object.fromEntries(
          Object.entries(data).filter(
            ([key]) =>
              !envelope.has(key) &&
              !prose.includes(key) &&
              !(key === "total_cost_usd" && data.cost_usd !== undefined),
          ),
        )}
      />
    </>
  );
}

interface EventCardProps {
  event: Event;
  toolName?: string;
  rawOnly?: boolean;
  expandRaw?: boolean;
}

function EventCard({ event, toolName, rawOnly, expandRaw }: EventCardProps) {
  const failed = activityFailed(event);

  return (
    <article className={`event${failed ? " activity-error" : ""}`}>
      <ActivityTime timestamp={event.timestamp} />
      <div className="activity-body">
        {!rawOnly && <strong>{eventTitle(event, failed, toolName)}</strong>}
        {!rawOnly && <EventBody event={event} />}
        <RawResponse event={event} defaultOpen={expandRaw} />
      </div>
    </article>
  );
}

interface EventDetailsProps {
  events: Event[];
  rawOnly?: boolean;
  /** Default for the newest disclosure; user toggles remain local to each response. */
  expandNewestRaw?: boolean;
}

/** `rawOnly` hides content already shown by the group. */
export function EventDetails({
  events,
  rawOnly,
  expandNewestRaw = rawOnly,
}: EventDetailsProps) {
  const toolNames = new Map(
    events
      .filter((event) => event.type === "tool.started")
      .map((event) => [event.data.id, String(event.data.name ?? "Tool")]),
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
              expandRaw={expandNewestRaw && index === 0}
            />
          ))
      ) : (
        <p className="muted">Waiting for worker activity.</p>
      )}
    </>
  );
}

import { useState } from "react";

import { activityPresentation } from "../../../../shared/providers/activity/presentation";
import { scalarText } from "../../../../shared/text";
import type { Event } from "../../../app/state/types";
import { Button } from "../../../shared/components/button/button";
import { ActivityContent } from "./activity-content";
import { activityFailed } from "./activity-timeline";
import { eventTitle, label, responsePreview } from "./activity-utils";
import { ActivityValue } from "./activity-value";
import { EVENT_TAIL_SIZE } from "./event-history";

const envelope = new Set([
  "raw_response",
  "activity",
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

function ReplyResult({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const preview = responsePreview(text);
  const shortened = preview !== text;

  return (
    <>
      <ActivityContent content={expanded ? text : preview} />
      {shortened && (
        <Button
          variant="text"
          underline
          className="activity-reply-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Less" : "More"}
        </Button>
      )}
    </>
  );
}

export function EventBody({ event }: { event: Event }) {
  const data = event.data;

  if (event.type === "agent.message" || event.type === "agent.content") {
    return <ActivityContent content={data.content ?? data.text} markdown />;
  }

  if (event.type === "agent.reply") {
    return <ReplyResult text={scalarText(data.text)} />;
  }

  if (event.type === "tool.started") {
    return <ActivityValue value={data.input} />;
  }

  if (event.type === "tool.completed") {
    return <ActivityContent content={data.content ?? data.text} />;
  }

  const presentation = activityPresentation(event);

  if (presentation.stream) {
    const stream = presentation.stream;

    return (
      <>
        <p className="muted">{label(stream.title ?? "Streaming")}</p>
        {stream.content ? (
          <ActivityContent content={stream.content} markdown />
        ) : (
          <ActivityValue value={stream.details} />
        )}
      </>
    );
  }

  if (presentation.body) {
    return (
      <>
        {/* The worker's messages are Markdown; user messages carry tool results. */}
        <ActivityContent
          content={presentation.body.content}
          markdown={data.type === "assistant"}
        />
        {presentation.body.error != null && (
          <p className="error">{scalarText(presentation.body.error)}</p>
        )}
      </>
    );
  }

  const proseKeys = [
    "text",
    "summary",
    "description",
    "suggestion",
    "result",
    "content",
  ];

  const prose = proseKeys.filter(
    (key) =>
      typeof data[key] === "string" &&
      !(event.type === "agent.completed" && key === "result"),
  );

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
              !(event.type === "agent.completed" && key === "result") &&
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
      .map((event) => [event.data.id, scalarText(event.data.name, "Tool")]),
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

import { useState } from "react";

import { eventPayload } from "../../../../shared/events/payload";
import { activityPresentation } from "../../../../shared/providers/activity/presentation";
import {
  activityFailed,
  replyText,
} from "../../../../shared/tasks/activity/activity-events";
import { scalarText } from "../../../../shared/text";
import type { Event } from "../../../app/state/types";
import { Button } from "../../../shared/components/button/button";
import { JsonTree } from "../../../shared/components/json-tree/json-tree";
import { ActivityContent } from "./activity-content";
import { eventTitle, label, responsePreview } from "./activity-utils";
import { ActivityValue } from "./activity-value";
import { EVENT_TAIL_SIZE } from "./event-history";
import { OriginalResponseDetails } from "./original-response-details";

const envelope = new Set([
  "raw_response",
  "response_ref",
  "activity",
  "type",
  "subtype",
  "uuid",
  "session_id",
  "parent_tool_use_id",
]);

interface EventDataProps {
  event: Event;
  defaultOpen?: boolean;
}

function EventData({ event, defaultOpen }: EventDataProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  return (
    <details
      className="activity-raw"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Event data</summary>
      {open && <JsonTree value={event.data} />}
      {open && typeof event.data.response_ref === "string" && (
        <OriginalResponseDetails
          key={`${event.task_id}/${event.id}`}
          event={event}
        />
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
      <ActivityContent content={expanded ? text : preview} markdown />
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

  const message =
    eventPayload(event, "agent.message") ??
    eventPayload(event, "agent.content");

  if (message) {
    return (
      <ActivityContent
        content={message.content ?? message.text}
        markdown={message.role !== "user"}
      />
    );
  }

  const reply = replyText(event);

  if (reply !== undefined) {
    return <ReplyResult text={reply} />;
  }

  const toolStarted = eventPayload(event, "tool.started");

  if (toolStarted) {
    return <ActivityValue value={toolStarted.input} />;
  }

  const toolCompleted = eventPayload(event, "tool.completed");

  if (toolCompleted) {
    return <ActivityContent content={toolCompleted.content} />;
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
          markdown={presentation.body.role !== "user"}
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
        <EventData event={event} defaultOpen={expandRaw} />
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
    events.flatMap((event) => {
      const tool = eventPayload(event, "tool.started");

      return tool?.id ? [[tool.id, tool.name ?? "Tool"]] : [];
    }),
  );

  return (
    <>
      {events.length === EVENT_TAIL_SIZE && (
        <p className="help">
          Showing the most recent {EVENT_TAIL_SIZE} events.
        </p>
      )}
      {events.length ? (
        [...events].reverse().map((event, index) => {
          const id =
            eventPayload(event, "tool.started")?.id ??
            eventPayload(event, "tool.completed")?.id;

          return (
            <EventCard
              key={event.id}
              event={event}
              toolName={id ? toolNames.get(id) : undefined}
              rawOnly={rawOnly}
              expandRaw={expandNewestRaw && index === 0}
            />
          );
        })
      ) : (
        <p className="muted">Waiting for worker activity.</p>
      )}
    </>
  );
}

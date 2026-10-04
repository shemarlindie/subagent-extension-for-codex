import { useId, useState } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import type { ActivityGroup } from "../core/activity-timeline";
import { formatDuration } from "../core/duration";
import { useNow } from "./use-now";
import { TimelineDot, TimelineItem } from "./timeline";
import { MotionContent } from "./motion";
import { ActivityTime } from "./activity-time";
import { ActivityContent } from "./activity-content";
import { Icon } from "./icons";
import { EventBody, EventDetails } from "./event-details";
import { streamContent, thinkingOnly } from "../utils/activity";

function ThinkingClock({ start }: { start: number }) {
  const elapsed = useNow(true) - start;
  if (elapsed < 1000) return null;

  return (
    <span className="activity-badge activity-duration">
      {formatDuration(elapsed)}
    </span>
  );
}

interface ActivityGroupCardProps {
  group: ActivityGroup;
  first: boolean;
  last: boolean;
  span?: { start: number; end: number | null };
  running: boolean;
  runtimeMs?: number;
}

export function ActivityGroupCard({
  group,
  first,
  last,
  span,
  running,
  runtimeMs,
}: ActivityGroupCardProps) {
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
    (event) => event.type === "agent.message" || event.type === "agent.content",
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
    group.events.some((event) => event.type === "task.completed") &&
    runtimeMs !== undefined
      ? `Task completed after ${formatDuration(runtimeMs)}`
      : thoughtMs !== undefined
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
        <ActivityTime timestamp={group.events[0].timestamp} />
        <Collapsible.Trigger
          className="activity-debug-toggle"
          aria-label={`Debug activity: ${title}`}
          aria-controls={debugId}
          title={`Inspect ${group.events.length} raw ${group.events.length === 1 ? "response" : "responses"}`}
          onClick={() => setDebugMounted(true)}
        >
          <Icon name="bug" />
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
            <ActivityContent content={streamContent(group.events)} />
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
            <EventDetails
              events={group.events}
              rawOnly={showsOwnText}
              expandNewestRaw
            />
          </div>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}

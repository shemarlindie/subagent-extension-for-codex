import { Collapsible } from "@base-ui/react/collapsible";
import { useEffect, useId, useRef, useState } from "react";

import { Icon } from "../../../shared/components/icons/icons";
import { MotionContent } from "../../../shared/components/motion/motion";
import { reducedMotion } from "../../../shared/components/motion/motion-utils";
import { animateScrollIntoView } from "../../../shared/utils/animate-scroll-into-view";
import { useNow } from "../../../shared/utils/use-now";
import type { UserDateTimePreferences } from "../../../shared/utils/user-date-time";
import { formatDuration } from "../list/duration";
import { ActivityContent } from "./activity-content";
import { ActivityTime } from "./activity-time";
import type { ActivityGroup } from "./activity-timeline";
import { streamContent, thinkingOnly } from "./activity-utils";
import { EventBody, EventDetails } from "./event-details";
import { TimelineDot, TimelineItem } from "./timeline";

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
  preferences?: UserDateTimePreferences;
}

export function ActivityGroupCard({
  group,
  first,
  last,
  span,
  running,
  runtimeMs,
  preferences,
}: ActivityGroupCardProps) {
  const [debugOpen, setDebugOpen] = useState(false);
  // Avoid hidden content work until inspection; retain it afterward to keep disclosures open.
  const [debugMounted, setDebugMounted] = useState(false);
  const debugId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelReveal = useRef<(() => void) | undefined>(undefined);
  const conversational = group.kind === "message" || group.kind === "stream";

  const revealPanel = () => {
    cancelReveal.current?.();
    if (panelRef.current)
      cancelReveal.current = animateScrollIntoView(panelRef.current);
  };

  // Reduced motion skips the height transition, so the panel is full height at once.
  useEffect(() => {
    if (debugOpen && reducedMotion(panelRef.current)) revealPanel();
  }, [debugOpen]);

  useEffect(() => () => cancelReveal.current?.(), []);

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
      onOpenChange={(open) => {
        if (!open) cancelReveal.current?.();
        setDebugOpen(open);
      }}
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
        <ActivityTime
          timestamp={group.events[0].timestamp}
          preferences={preferences}
        />
        <Collapsible.Trigger
          className="activity-debug-toggle"
          aria-label={`Debug activity: ${title}`}
          aria-controls={debugId}
          title={`Inspect ${group.events.length} raw ${group.events.length === 1 ? "response" : "responses"}`}
          onClick={() => setDebugMounted(true)}
        >
          <Icon name="bug" size={12} />
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
        ref={panelRef}
        id={debugId}
        className="activity-debug-panel collapse-panel"
        onTransitionEnd={(event) => {
          // Child transitions bubble here; only the panel's own height settling
          // means it has finished opening.
          if (
            debugOpen &&
            event.target === event.currentTarget &&
            event.propertyName === "height"
          )
            revealPanel();
        }}
      >
        {debugMounted && (
          <div className="activity-debug-body">
            <div className="activity-debug-head">
              <p className="activity-debug-caption">
                Debug details · {group.events.length}{" "}
                {group.events.length === 1 ? "event" : "events"}
              </p>
              <ActivityTime
                timestamp={group.events[0].timestamp}
                preferences={preferences}
                format="chat"
              />
            </div>
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

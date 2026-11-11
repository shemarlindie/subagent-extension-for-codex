import { Collapsible } from "@base-ui/react/collapsible";
import {
  memo,
  type TransitionEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { eventPayload } from "../../../../shared/events/payload";
import {
  type ActivityGroup,
  replyText,
} from "../../../../shared/tasks/activity/activity-events";
import { Icon } from "../../../shared/components/icons/icons";
import { MotionContent } from "../../../shared/components/motion/motion-content";
import { reducedMotion } from "../../../shared/components/motion/motion-utils";
import { TooltipWrapper } from "../../../shared/components/tooltip";
import { animateScrollIntoView } from "../../../shared/utils/animate-scroll-into-view";
import { reuseUnchanged } from "../../../shared/utils/reuse-unchanged";
import { useNow } from "../../../shared/utils/use-now";
import type { UserDateTimePreferences } from "../../../shared/utils/user-date-time";
import { MarkdownView } from "../../file-preview/markdown/markdown-view";
import { formatDuration } from "../list/duration";
import { ActivityContent } from "./activity-content";
import { ActivityTime } from "./activity-time";
import {
  rateLimitStats,
  streamContent,
  summaryIsParentMessage,
  summaryIsResponse,
  thinkingOnly,
  turnStats,
  userMessageText,
  visibleMessageContent,
} from "./activity-utils";
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
  /** The row's thinking is still going, so it shows a running clock. */
  thinking: boolean;
  /** The task's runtime, given only to the row that reports its completion. */
  runtimeMs?: number;
  preferences?: UserDateTimePreferences;
}

function GroupCard({
  group,
  first,
  last,
  span,
  thinking,
  runtimeMs,
  preferences,
}: ActivityGroupCardProps) {
  const [debugOpen, setDebugOpen] = useState(false);
  // Avoid hidden content work until inspection; retain it afterward to keep disclosures open.
  const [debugMounted, setDebugMounted] = useState(false);
  const debugId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const cancelReveal = useRef<(() => void) | undefined>(undefined);
  const conversational = group.kind === "message" || group.kind === "stream";

  const revealPanel = () => {
    cancelReveal.current?.();

    if (panelRef.current) {
      cancelReveal.current = animateScrollIntoView(panelRef.current);
    }
  };

  // Closing from the panel's end brings its row back, with focus on the toggle that reopens it.
  const collapseDebug = () => {
    cancelReveal.current?.();
    setDebugOpen(false);
    toggleRef.current?.focus({ preventScroll: true });

    if (headingRef.current) {
      cancelReveal.current = animateScrollIntoView(headingRef.current);
    }
  };

  const handleDebugOpenChange = (open: boolean) => {
    if (!open) cancelReveal.current?.();
    setDebugOpen(open);
  };

  // Child transitions bubble here; only the panel's own height settling
  // means it has finished opening.
  const handlePanelTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (
      debugOpen &&
      event.target === event.currentTarget &&
      event.propertyName === "height"
    ) {
      revealPanel();
    }
  };

  // Reduced motion skips the height transition, so the panel is full height at once.
  useEffect(() => {
    if (debugOpen && reducedMotion(panelRef.current)) revealPanel();
  }, [debugOpen]);

  useEffect(() => () => cancelReveal.current?.(), []);

  const reply = group.events.find((event) => replyText(event) !== undefined);

  const userMessages = group.events.flatMap((event) => {
    const text = userMessageText(event);

    return text === undefined ? [] : [{ id: event.id, text }];
  });

  // Messages, replies and event/status rows with a summary show their text above;
  // tools and operations keep the structured debug body for their input and output.
  const showsOwnText =
    conversational ||
    userMessages.length > 0 ||
    reply !== undefined ||
    ((group.kind === "event" || group.kind === "status") &&
      group.summary !== undefined);

  const markdownSummary =
    group.summary !== undefined &&
    (summaryIsResponse(group.events, group.summary) ||
      summaryIsParentMessage(group.events, group.summary));

  const contentEvents = group.events.filter(
    (event) => event.type === "agent.message" || event.type === "agent.content",
  );

  const hasResponseEvent = contentEvents.some((event) => {
    const message = eventPayload(event, "agent.message");

    return message !== undefined;
  });

  const visibleContent = contentEvents.flatMap((event) => {
    const message =
      eventPayload(event, "agent.message") ??
      eventPayload(event, "agent.content");

    const content = visibleMessageContent(event, hasResponseEvent);

    return content.length
      ? [
          {
            id: event.id,
            content,
            markdown: !hasResponseEvent && message?.role !== "user",
          },
        ]
      : [];
  });

  const streamedContent = contentEvents.length
    ? []
    : streamContent(group.events);

  // Thinking-only messages read as a quiet "Thinking" row, not an assistant reply.
  // Their text is mostly empty, so it is only shown through the debug view.
  const quietThinking = conversational && thinkingOnly(contentEvents);

  // The heading and the debug toggle's label name the row the same way.
  // A finished thinking row states its duration in place of "Thinking…".
  const thoughtMs =
    span?.end != null && (group.kind !== "message" || quietThinking)
      ? span.end - span.start
      : undefined;

  let title = group.title;

  if (runtimeMs !== undefined) {
    title = `Task completed after ${formatDuration(runtimeMs)}`;
  } else if (thoughtMs !== undefined) {
    title =
      thoughtMs >= 1000
        ? `Thought for ${formatDuration(thoughtMs)}`
        : "Thought";
  } else if (quietThinking) {
    title = "Thinking";
  }

  // A completed turn states its duration, tokens and cost without opening debug.
  const completion = group.events.find(
    (event) => event.type === "agent.completed",
  );

  const stats = completion
    ? [turnStats(completion).join(" · ")].filter(Boolean)
    : rateLimitStats(group.events, preferences);

  let badge: string | undefined;
  if (group.state === "running") badge = "Running";
  else if (group.state === "failed") badge = "Failed";
  else if (group.state === "completed" && !conversational) badge = "Done";

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
      onOpenChange={handleDebugOpenChange}
      data-activity-id={group.id}
      data-debug-open={debugOpen || undefined}
      className={`activity-group activity-${group.kind}${quietThinking ? " activity-thinking-only" : ""}${group.state === "failed" ? " activity-error" : ""}`}
    >
      <div className="activity-group-heading" ref={headingRef}>
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
          {thinking && span && <ThinkingClock start={span.start} />}
        </span>
        <ActivityTime
          timestamp={group.events[0].timestamp}
          preferences={preferences}
        />
        <TooltipWrapper
          label={`Inspect ${group.events.length} raw ${group.events.length === 1 ? "response" : "responses"}`}
          triggerLabel={`Debug activity: ${title}`}
        >
          <Collapsible.Trigger
            ref={toggleRef}
            className="activity-debug-toggle"
            aria-controls={debugId}
            onClick={() => setDebugMounted(true)}
          >
            <Icon name="bug" size={12} />
          </Collapsible.Trigger>
        </TooltipWrapper>
      </div>
      {reply && (
        <div className="activity-body">
          <EventBody event={reply} />
        </div>
      )}
      {userMessages.map((message) => (
        <div key={message.id} className="chat-message" data-from="user">
          <p className="chat-bubble">{message.text}</p>
        </div>
      ))}
      {group.summary &&
        userMessages.length === 0 &&
        (markdownSummary ? (
          // The worker's response and the parent agent's messages are written in Markdown.
          <div className="activity-group-summary activity-markdown">
            <MarkdownView content={group.summary} />
          </div>
        ) : (
          <p
            className={
              group.events.some((event) => event.type === "task.turn_ended")
                ? "activity-group-secondary"
                : "activity-group-summary"
            }
            title={group.summary}
          >
            {group.summary}
          </p>
        ))}
      {stats.map((text, index) => (
        <p key={index} className="activity-group-stats">
          {text}
        </p>
      ))}
      {hasResponseEvent && !quietThinking && (
        <p className="activity-group-secondary">Started a response...</p>
      )}
      {conversational &&
        !quietThinking &&
        (visibleContent.length > 0 || streamedContent.length > 0) && (
          <div className="activity-body">
            {visibleContent.length ? (
              visibleContent.map((item) => (
                <ActivityContent
                  key={item.id}
                  content={item.content}
                  markdown={item.markdown}
                />
              ))
            ) : (
              <ActivityContent content={streamedContent} markdown />
            )}
          </div>
        )}
      {/* Always mounted so the toggle's aria-controls resolves while closed. */}
      <Collapsible.Panel
        keepMounted
        ref={panelRef}
        id={debugId}
        className="activity-debug-panel collapse-panel"
        onTransitionEnd={handlePanelTransitionEnd}
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
              <TooltipWrapper
                label="Collapse"
                triggerLabel={`Collapse debug activity: ${title}`}
              >
                <button
                  type="button"
                  className="activity-debug-collapse"
                  aria-controls={debugId}
                  onClick={collapseDebug}
                >
                  <Icon name="chevron-down" size={12} />
                </button>
              </TooltipWrapper>
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

/**
 * Grouping builds new groups on every render, so the card compares its props
 * by contents and renders only when its own group or settings change.
 */
export const ActivityGroupCard = memo(
  GroupCard,
  (previous, next) => reuseUnchanged(previous, next) === previous,
);

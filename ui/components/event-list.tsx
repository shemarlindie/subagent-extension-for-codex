import { memo } from "react";
import type { Event } from "../core/types";
import { groupActivity, thinkingSpan } from "../core/activity-timeline";
import {
  EVENT_TAIL_SIZE,
  describeDropped,
  type DroppedSummary,
} from "../core/event-history";
import { useActivityScroll } from "./use-activity-scroll";
import { Timeline } from "./timeline";
import { Presence } from "./motion";
import { ActivityGroupCard } from "./activity-group-card";

export { EventDetails } from "./event-details";

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
            <ActivityGroupCard
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

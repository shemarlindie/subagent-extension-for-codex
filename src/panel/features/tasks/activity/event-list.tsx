import { memo } from "react";

import type { Event } from "../../../app/state/types";
import { Icon } from "../../../shared/components/icons/icons";
import { Presence } from "../../../shared/components/motion/motion";
import type { ReadingState } from "../evidence/reading-state";
import { ActivityGroupCard } from "./activity-group-card";
import { groupActivity, thinkingSpan } from "./activity-timeline";
import {
  describeDropped,
  type DroppedSummary,
  EVENT_TAIL_SIZE,
} from "./event-history";
import { Timeline } from "./timeline";
import { useActivityScroll } from "./use-activity-scroll";

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

interface EventListProps {
  events: Event[];
  reading?: ReadingState;
  active?: boolean;
  runtimeMs?: number;
  /** What fell off the front of `events`, tallied by the event reader. */
  dropped?: DroppedSummary;
  /** The worker is mid-turn, so a thinking row with nothing after it is still going. */
  running?: boolean;
}

// Polls keep the same events array when nothing changed, so a hidden tab skips work.
export const EventList = memo(function EventList({
  events,
  reading,
  active,
  running = false,
  runtimeMs,
  dropped,
}: EventListProps) {
  const groups = groupActivity(events).sort(
    (a, b) => b.events.at(-1)!.id - a.events.at(-1)!.id,
  );

  const { viewportRef, pinned, scrollToTop } = useActivityScroll(
    events,
    active,
    reading,
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
              runtimeMs={runtimeMs}
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
          <Icon name="arrow-up" size={10} />
        </button>
      </Presence>
    </section>
  );
});

import { memo } from "react";

import type { Event } from "../../../app/state/types";
import { ScrollLatestButton } from "../../../shared/components/scroll-latest-button/scroll-latest-button";
import type { UserDateTimePreferences } from "../../../shared/utils/user-date-time";
import type { ReadingState } from "../evidence/reading-state";
import { useReadingScroll } from "../evidence/use-reading-scroll";
import { ActivityGroupCard } from "./activity-group-card";
import { groupActivity, thinkingSpan } from "./activity-timeline";
import {
  describeDropped,
  type DroppedSummary,
  EVENT_TAIL_SIZE,
} from "./event-history";
import { Timeline } from "./timeline";

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
  /** The host's locale and time zone, which Chat's timestamps follow too. */
  preferences?: UserDateTimePreferences;
}

// Polls keep the same events array when nothing changed, so a hidden tab skips work.
export const EventList = memo(function EventList({
  events,
  reading,
  active = true,
  running = false,
  runtimeMs,
  dropped,
  preferences,
}: EventListProps) {
  // Oldest first, like Chat; progress moves an operation to the end.
  const groups = groupActivity(events).sort(
    (a, b) => a.events.at(-1)!.id - b.events.at(-1)!.id,
  );

  const ready = events.length > 0;
  const trimmed = events.length === EVENT_TAIL_SIZE;

  const { viewportRef, pinned, scrollToLatest } = useReadingScroll({
    reading,
    active,
    ready,
    itemAttribute: "data-activity-id",
    animateRows: true,
  });

  return (
    <section className="activity-timeline" aria-label="Worker activity">
      <div
        ref={viewportRef}
        className="activity-viewport"
        tabIndex={0}
        role="region"
        aria-label="Activity history"
      >
        {/* Sits where the rail fades in, since the oldest rows are the ones dropped. */}
        {trimmed && (
          <p className="help activity-trimmed-note">
            <span className="activity-trimmed-lead">
              Showing the most recent {EVENT_TAIL_SIZE} events.
            </span>
            {dropped && dropped.task_id === events[0].task_id && (
              <DroppedNote summary={dropped} />
            )}
          </p>
        )}
        <Timeline trimmed={trimmed}>
          {groups.map((group, index) => (
            <ActivityGroupCard
              key={group.id}
              group={group}
              first={index === 0}
              last={index === groups.length - 1}
              span={thinkingSpan(group, events)}
              running={running}
              runtimeMs={runtimeMs}
              preferences={preferences}
            />
          ))}
        </Timeline>
      </div>
      <ScrollLatestButton
        show={ready && !pinned}
        direction="down"
        label="Scroll to latest activity"
        className="activity-scroll-latest"
        onClick={scrollToLatest}
      />
    </section>
  );
});

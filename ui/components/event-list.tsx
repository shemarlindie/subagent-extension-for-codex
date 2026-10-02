import type { Event } from "../core/types";
import { EVENT_TAIL_SIZE } from "../core/event-history";
export function EventList({ events }: { events: Event[] }) {
  return (
    <>
      {events.length === EVENT_TAIL_SIZE && (
        <p className="help">
          Showing the most recent {EVENT_TAIL_SIZE} events.
        </p>
      )}
      {events.length ? (
        [...events].reverse().map((event) => (
          <div className="event" key={event.id}>
            <time>
              {new Date(event.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
            <div>
              <strong>{event.type.replaceAll(".", " / ")}</strong>
              {Object.keys(event.data).length > 0 && (
                <pre data-scroll={`event-${event.id}`}>
                  {String(
                    event.data.text ?? JSON.stringify(event.data, null, 2),
                  )}
                </pre>
              )}
            </div>
          </div>
        ))
      ) : (
        <p className="muted">Waiting for worker activity.</p>
      )}
    </>
  );
}

import { decodedEvent } from "../../../src/shared/events/decode";
import type { EventEnvelope } from "../../../src/shared/events/event-contract";
import { originalResponseLookup } from "../../../src/shared/providers/claude/responses";

/** Ordinary reads, which leave original responses to the details lookup. */
export const withoutOriginalResponses = (events: readonly EventEnvelope[]) =>
  events.map((event) =>
    decodedEvent({
      ...event,
      data: { ...event.data, raw_response: undefined },
    }),
  );

/** Answers `app_get_original_response` from fixture events. */
export function originalResponseResult(
  events: readonly EventEnvelope[],
  args: Record<string, unknown>,
) {
  const original = originalResponseLookup(events)({
    task_id: String(args.task_id),
    data: { response_ref: args.response_ref },
  });

  return original ? { available: true, original } : { available: false };
}

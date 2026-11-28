import { activityPresentationSchema } from "../providers/activity/presentation-contract.generated.js";
import {
  eventEnvelopeSchema,
  eventPayloadMapSchema,
} from "./event-contract.generated.js";
import type { EventEnvelope } from "./event-contract.js";
import type { EventType, EventView } from "./event-types.js";
import type { DecodedEvent, Event } from "./types.js";

const knownEventTypes = new Set(Object.keys(eventPayloadMapSchema.shape));

/**
 * Validate the fields understood by this build and retain the original event
 * data separately. Invalid known payloads and unknown event names remain opaque.
 */
export function decodeEventView(type: string, data: unknown): EventView {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Event data must be an object");
  }

  if (!knownEventTypes.has(type)) {
    return {
      kind: "opaque",
      type,
      data: data as Record<string, unknown>,
    };
  }

  const eventType = type as EventType;
  const schema = eventPayloadMapSchema.shape[eventType];
  const parsed = schema.safeParse(data);

  if (!parsed.success) {
    return { kind: "opaque", type, data: data as Record<string, unknown> };
  }

  // The runtime key check and its matching schema validate this known pair.
  return {
    kind: "known",
    type: eventType,
    data: parsed.data,
  } as EventView;
}

export function decodedEvent(event: EventEnvelope | Event): DecodedEvent {
  const parsedPresentation = activityPresentationSchema.safeParse(
    event.data.activity,
  );

  return {
    id: event.id,
    task_id: event.task_id,
    type: event.type,
    timestamp: event.timestamp,
    data: event.data,
    view: decodeEventView(event.type, event.data),
    ...(parsedPresentation.success
      ? { presentation: parsedPresentation.data }
      : {}),
  };
}

/** Validates an event received over the panel transport and builds its view. */
export function decodeEventEnvelope(input: unknown): DecodedEvent {
  const parsed = eventEnvelopeSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error("The service returned an invalid event envelope");
  }

  return decodedEvent({
    ...parsed.data,
    // Keep all JSON fields so opaque and extension payloads remain inspectable.
    data: parsed.data.data,
  });
}

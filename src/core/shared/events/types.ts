import type { ActivityPresentation } from "../providers/activity/presentation-contract.js";
import type { EventEnvelope } from "./event-contract.js";
import type { EventView } from "./event-types.js";

/** A durable event with the typed or opaque view built at its boundary. */
export interface Event extends EventEnvelope {
  view: EventView;
  /** Validated normalized presentation extracted from the provider payload. */
  presentation?: ActivityPresentation;
}

export type DecodedEvent = Event;

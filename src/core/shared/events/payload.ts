import type { EventPayloadMap } from "./event-contract.js";
import type { EventType } from "./event-types.js";
import type { Event } from "./types.js";

/** Returns only payload fields that passed the event-specific boundary schema. */
export function eventPayload<K extends EventType>(
  event: Event,
  type: K,
): EventPayloadMap[K] | undefined {
  const view = event.view;

  if (view.kind !== "known" || view.type !== type) return undefined;

  // The stored discriminants are checked together; TypeScript cannot keep the
  // generic key correlated through the mapped union's indexed access.
  return view.data as EventPayloadMap[K];
}

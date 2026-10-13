import type { Event } from "../../events/types.js";
import type { ActivityPresentation } from "./types.js";

/** Rendering reads only the presentation supplied by the provider. */
export function activityPresentation(event: Event): ActivityPresentation {
  return event.presentation ?? {};
}
